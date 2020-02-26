#!/usr/bin/env node
// Temporary demo client
// Works both in browser and node.js
const fs = require('fs')
const axios = require('axios')
const assert = require('assert')
const snarkjs = require('snarkjs')
const crypto = require('crypto')
const circomlib = require('circomlib')
const bigInt = snarkjs.bigInt
const merkleTree = require('./lib/MerkleTree')
const Web3 = require('web3')
const buildGroth16 = require('websnark/src/groth16')
const websnarkUtils = require('websnark/src/utils')
const { toWei, fromWei, toBN, BN } = require('web3-utils')
const config = require('./config')
const program = require('commander')

let web3, tornado, circuit, proving_key, groth16, erc20, senderAccount, netId
let MERKLE_TREE_HEIGHT, ETH_AMOUNT, TOKEN_AMOUNT, PRIVATE_KEY

/** Whether we are in a browser or node.js */
const inBrowser = (typeof window !== 'undefined')
let isLocalRPC = false
const networks = { '1': 'mainnet', '42': 'kovan' }

/** Generate random number of specified byte length */
const rbigint = nbytes => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))

/** Compute pedersen hash */
const pedersenHash = data => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/** BigNumber to hex string of specified length */
function toHex(number, length = 32) {
  const str = number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)
  return '0x' + str.padStart(length * 2, '0')
}

/** Display ETH account balance */
async function printETHBalance({ address, name }) {
  console.log(`${name} ETH balance is`, web3.utils.fromWei(await web3.eth.getBalance(address)))
}

/** Display ERC20 account balance */
async function printERC20Balance({ address, name, tokenAddress }) {
  const erc20ContractJson = require('./build/contracts/ERC20Mock.json')
  erc20 = tokenAddress ? new web3.eth.Contract(erc20ContractJson.abi, tokenAddress) : erc20
  console.log(`${name} Token Balance is`, web3.utils.fromWei(await erc20.methods.balanceOf(address).call()))
}

/**
 * Create deposit object from secret and nullifier
 */
function createDeposit({ nullifier, secret }) {
  const deposit = { nullifier, secret }
  deposit.preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(deposit.preimage)
  deposit.nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31))
  return deposit
}

/**
 * Make a deposit
 * @param currency Сurrency
 * @param amount Deposit amount
 */
async function deposit({ currency, amount }) {
  const deposit = createDeposit({ nullifier: rbigint(31), secret: rbigint(31) })
  const note = toHex(deposit.preimage, 62)
  const noteString = `tornado-${currency}-${amount}-${netId}-${note}`
  console.log(`Your note: ${noteString}`)
  if (currency === 'eth') {
    await printETHBalance({ address: tornado._address, name: 'Tornado' })
    await printETHBalance({ address: senderAccount, name: 'Sender account' })
    const value = isLocalRPC ? ETH_AMOUNT : fromDecimals({ amount, decimals: 18 })
    console.log('Submitting deposit transaction')
    await tornado.methods.deposit(toHex(deposit.commitment)).send({ value, from: senderAccount, gas:2e6 })
    await printETHBalance({ address: tornado._address, name: 'Tornado' })
    await printETHBalance({ address: senderAccount, name: 'Sender account' })
  } else {
    await printERC20Balance({ address: tornado._address, name: 'Tornado' })
    await printERC20Balance({ address: senderAccount, name: 'Sender account' })
    const decimals = isLocalRPC ? 18 : config.deployments[`netId${netId}`][currency].decimals
    const tokenAmount = isLocalRPC ? TOKEN_AMOUNT : fromDecimals({ amount, decimals })
    if(isLocalRPC) {
      console.log('Minting some test tokens to deposit')
      await erc20.methods.mint(senderAccount, tokenAmount).send({ from: senderAccount, gas: 2e6 })
    }

    const allowance = await erc20.methods.allowance(senderAccount, tornado._address).call({ from: senderAccount })
    console.log('Current allowance is', fromWei(allowance))
    if (toBN(allowance).lt(toBN(tokenAmount))) {
      console.log('Approving tokens for deposit')
      await erc20.methods.approve(tornado._address, tokenAmount).send({ from: senderAccount, gas:1e6 })
    }

    console.log('Submitting deposit transaction')
    await tornado.methods.deposit(toHex(deposit.commitment)).send({ from: senderAccount, gas:2e6 })
    await printERC20Balance({ address: tornado._address, name: 'Tornado' })
    await printERC20Balance({ address: senderAccount, name: 'Sender account' })
  }

  return noteString
}

/**
 * Generate merkle tree for a deposit.
 * Download deposit events from the tornado, reconstructs merkle tree, finds our deposit leaf
 * in it and generates merkle proof
 * @param deposit Deposit object
 */
async function generateMerkleProof(deposit) {
  // Get all deposit events from smart contract and assemble merkle tree from them
  console.log('Getting current state from tornado contract')
  const events = await tornado.getPastEvents('Deposit', { fromBlock: 0, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
    .map(e => e.returnValues.commitment)
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves)

  // Find current commitment in the tree
  const depositEvent = events.find(e => e.returnValues.commitment === toHex(deposit.commitment))
  const leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1

  // Validate that our data is correct
  const isValidRoot = await tornado.methods.isKnownRoot(toHex(await tree.root())).call()
  const isSpent = await tornado.methods.isSpent(toHex(deposit.nullifierHash)).call()
  assert(isValidRoot === true, 'Merkle tree is corrupted')
  assert(isSpent === false, 'The note is already spent')
  assert(leafIndex >= 0, 'The deposit is not found in the tree')

  // Compute merkle proof of our commitment
  return await tree.path(leafIndex)
}

/**
 * Generate SNARK proof for withdrawal
 * @param note Note
 * @param recipient Funds recipient
 * @param relayer Relayer address
 * @param fee Relayer fee
 * @param refund Receive ether for exchanged tokens
 */
async function generateProof({ deposit, recipient, relayerAddress = 0, fee = 0, refund = 0 }) {
  // Compute merkle proof of our commitment
  const { root, path_elements, path_index } = await generateMerkleProof(deposit)

  // Prepare circuit input
  const input = {
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHash,
    recipient: bigInt(recipient),
    relayer: bigInt(relayerAddress),
    fee: bigInt(fee),
    refund: bigInt(refund),

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndices: path_index,
  }

  console.log('Generating SNARK proof')
  console.time('Proof time')
  const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
  const { proof } = websnarkUtils.toSolidityInput(proofData)
  console.timeEnd('Proof time')

  const args = [
    toHex(input.root),
    toHex(input.nullifierHash),
    toHex(input.recipient, 20),
    toHex(input.relayer, 20),
    toHex(input.fee),
    toHex(input.refund)
  ]

  return { proof, args }
}

/**
 * Do an ETH withdrawal
 * @param noteString Note to withdraw
 * @param recipient Recipient address
 */
async function withdraw({ deposit, currency, amount, recipient, relayerURL, refund = '0' }) {
  if (currency === 'eth' && refund !== '0') {
    throw new Error('The ETH purchase is supposted to be 0 for ETH withdrawals')
  }
  refund = toWei(refund)
  if (relayerURL) {
    const relayerStatus = await axios.get(relayerURL + '/status')
    const { relayerAddress, netId, gasPrices, ethPrices, relayerServiceFee } = relayerStatus.data
    assert(netId === await web3.eth.net.getId() || netId === '*', 'This relay is for different network')
    console.log('Relay address: ', relayerAddress)

    const decimals = isLocalRPC ? 18 : config.deployments[`netId${netId}`][currency].decimals
    const fee = calculateFee({ gasPrices, currency, amount, refund, ethPrices, relayerServiceFee, decimals })
    if (fee.gt(fromDecimals({ amount, decimals }))) {
      throw new Error('Too high refund')
    }
    const { proof, args } = await generateProof({ deposit, recipient, relayerAddress, fee, refund })

    console.log('Sending withdraw transaction through relay')
    try{
      const relay = await axios.post(relayerURL + '/relay', { contract: tornado._address, proof, args })
      if (netId === 1 || netId === 42) {
        console.log(`Transaction submitted through the relay. View transaction on etherscan https://${networks[netId]}.etherscan.io/tx/${relay.data.txHash}`)
      } else {
        console.log(`Transaction submitted through the relay. The transaction hash is ${relay.data.txHash}`)
      }

      const receipt = await waitForTxReceipt({ txHash: relay.data.txHash })
      console.log('Transaction mined in block', receipt.blockNumber)
    } catch(e) {
      if (e.response) {
        console.error(e.response.data.error)
      } else {
        console.error(e.message)
      }
    }
  } else {
    const { proof, args } = await generateProof({ deposit, recipient, refund })

    console.log('Submitting withdraw transaction')
    await tornado.methods.withdraw(proof, ...args).send({ from: senderAccount, value: refund.toString(), gas: 1e6 })
      .on('transactionHash', function(txHash){
        if (netId === 1 || netId === 42) {
          console.log(`View transaction on etherscan https://${networks[netId]}.etherscan.io/tx/${txHash}`)
        } else {
          console.log(`The transaction hash is ${txHash}`)
        }
      }).on('error', function(e){
        console.error('on transactionHash error', e.message)
      })
  }
  console.log('Done')
}

function fromDecimals({ amount, decimals }) {
  amount = amount.toString()
  let ether = amount.toString()
  const base = new BN('10').pow(new BN(decimals))
  const baseLength = base.toString(10).length - 1 || 1

  const negative = ether.substring(0, 1) === '-'
  if (negative) {
    ether = ether.substring(1)
  }

  if (ether === '.') {
    throw new Error('[ethjs-unit] while converting number ' + amount + ' to wei, invalid value')
  }

  // Split it into a whole and fractional part
  const comps = ether.split('.')
  if (comps.length > 2) {
    throw new Error(
      '[ethjs-unit] while converting number ' + amount + ' to wei,  too many decimal points'
    )
  }

  let whole = comps[0]
  let fraction = comps[1]

  if (!whole) {
    whole = '0'
  }
  if (!fraction) {
    fraction = '0'
  }
  if (fraction.length > baseLength) {
    throw new Error(
      '[ethjs-unit] while converting number ' + amount + ' to wei, too many decimal places'
    )
  }

  while (fraction.length < baseLength) {
    fraction += '0'
  }

  whole = new BN(whole)
  fraction = new BN(fraction)
  let wei = whole.mul(base).add(fraction)

  if (negative) {
    wei = wei.mul(negative)
  }

  return new BN(wei.toString(10), 10)
}

function calculateFee({ gasPrices, currency, amount, refund, ethPrices, relayerServiceFee, decimals }) {
  const feePercent = toBN(fromDecimals({ amount, decimals })).mul(toBN(relayerServiceFee * 10)).div(toBN('1000'))
  const expense = toBN(toWei(gasPrices.fast.toString(), 'gwei')).mul(toBN(5e5))
  let desiredFee
  switch (currency) {
  case 'eth': {
    desiredFee = expense.add(feePercent)
    break
  }
  default: {
    desiredFee =
        expense.add(toBN(refund))
          .mul(toBN(10 ** decimals))
          .div(toBN(ethPrices[currency]))
    desiredFee = desiredFee.add(feePercent)
    break
  }
  }
  return desiredFee
}

/**
 * Waits for transaction to be mined
 * @param txHash Hash of transaction
 * @param attempts
 * @param delay
 */
function waitForTxReceipt({ txHash, attempts = 60, delay = 1000 }) {
  return new Promise((resolve, reject) => {
    const checkForTx = async (txHash, retryAttempt = 0) => {
      const result = await web3.eth.getTransactionReceipt(txHash)
      if (!result || !result.blockNumber) {
        if (retryAttempt <= attempts) {
          setTimeout(() => checkForTx(txHash, retryAttempt + 1), delay)
        } else {
          reject(new Error('tx was not mined'))
        }
      } else {
        resolve(result)
      }
    }
    checkForTx(txHash)
  })
}

/**
 * Parses Tornado.cash note
 * @param noteString the note
 */
function parseNote(noteString) {
  const noteRegex = /tornado-(?<currency>\w+)-(?<amount>[\d.]+)-(?<netId>\d+)-0x(?<note>[0-9a-fA-F]{124})/g
  const match = noteRegex.exec(noteString)
  if (!match) {
    throw new Error('The note has invalid format')
  }

  const buf = Buffer.from(match.groups.note, 'hex')
  const nullifier = bigInt.leBuff2int(buf.slice(0, 31))
  const secret = bigInt.leBuff2int(buf.slice(31, 62))
  const deposit = createDeposit({ nullifier, secret })
  const netId = Number(match.groups.netId)

  return { currency: match.groups.currency, amount: match.groups.amount, netId, deposit }
}

/**
 * Init web3, contracts, and snark
 */
async function init({ rpc, noteNetId, currency = 'dai', amount = '100' }) {
  let contractJson, erc20ContractJson, erc20tornadoJson, tornadoAddress, tokenAddress
  // TODO do we need this? should it work in browser really?
  if (inBrowser) {
    // Initialize using injected web3 (Metamask)
    // To assemble web version run `npm run browserify`
    web3 = new Web3(window.web3.currentProvider, null, { transactionConfirmationBlocks: 1 })
    contractJson = await (await fetch('build/contracts/ETHTornado.json')).json()
    circuit = await (await fetch('build/circuits/withdraw.json')).json()
    proving_key = await (await fetch('build/circuits/withdraw_proving_key.bin')).arrayBuffer()
    MERKLE_TREE_HEIGHT = 16
    ETH_AMOUNT = 1e18
    TOKEN_AMOUNT = 1e19
  } else {
    // Initialize from local node
    web3 = new Web3(rpc, null, { transactionConfirmationBlocks: 1 })
    contractJson = require('./build/contracts/ETHTornado.json')
    circuit = require('./build/circuits/withdraw.json')
    proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
    require('dotenv').config()
    MERKLE_TREE_HEIGHT = process.env.MERKLE_TREE_HEIGHT
    ETH_AMOUNT = process.env.ETH_AMOUNT
    TOKEN_AMOUNT = process.env.TOKEN_AMOUNT
    PRIVATE_KEY = process.env.PRIVATE_KEY
    erc20ContractJson = require('./build/contracts/ERC20Mock.json')
    erc20tornadoJson = require('./build/contracts/ERC20Tornado.json')
  }
  groth16 = await buildGroth16()
  netId = await web3.eth.net.getId()
  if (noteNetId && Number(noteNetId) !== netId) {
    throw new Error('This note is for a different network. Specify the --rpc option explicitly')
  }
  isLocalRPC = netId > 42

  if (isLocalRPC) {
    tornadoAddress = currency === 'eth' ? contractJson.networks[netId].address : erc20tornadoJson.networks[netId].address
    tokenAddress = currency !== 'eth' ? erc20ContractJson.networks[netId].address : null
    senderAccount = (await web3.eth.getAccounts())[0]
  } else {
    try{
      tornadoAddress = config.deployments[`netId${netId}`][currency].instanceAddress[amount]
      if (!tornadoAddress) {
        throw new Error()
      }
      tokenAddress = config.deployments[`netId${netId}`][currency].tokenAddress
      const account = web3.eth.accounts.privateKeyToAccount('0x' + PRIVATE_KEY)
      web3.eth.accounts.wallet.add('0x' + PRIVATE_KEY)
      web3.eth.defaultAccount = account.address
      senderAccount = account.address
    } catch(e) {
      console.error('There is no such tornado instance, check the currency and amount you provide')
      process.exit(1)
    }
  }
  tornado = new web3.eth.Contract(contractJson.abi, tornadoAddress)
  erc20 = currency !== 'eth' ? new web3.eth.Contract(erc20ContractJson.abi, tokenAddress) : {}
}

async function main() {
  process.setMaxListeners(30)
  if (inBrowser) {
    // window.deposit = deposit
    // window.depositErc20 = depositErc20
    // window.withdraw = async () => {
    //   const note = prompt('Enter the note to withdraw')
    //   const recipient = (await web3.eth.getAccounts())[0]
    //   await withdraw(note, recipient)
    // }
    // init()
  } else {
    program
      .option('-r, --rpc <URL>', 'The RPC, CLI should interact with', 'http://localhost:8545')
      .option('-R, --relayer <URL>', 'Withdraw via relayer')
    program
      .command('deposit <currency> <amount>')
      .description('Submit a deposit of specified currency and amount from default eth account and return the resulting note. The currency is one of (ETH|DAI|cDAI|USDC|cUSDC|USDT). The amount depends on currency, see config.js file or visit https://tornado.cash.')
      .action(async (currency, amount) => {
        currency = currency.toLowerCase()
        await init({ rpc: program.rpc, currency, amount })
        await deposit({ currency, amount })
      })
    program
      .command('withdraw <note> <recipient> [ETH_purchase]')
      .description('Withdraw a note to a recipient account using relayer or specified private key. You can exchange some of your deposit`s tokens to ETH during the withdrawal by specifing ETH_purchase (e.g. 0.01) to pay for gas in future transactions. Also see the --relayer option.')
      .action(async (noteString, recipient, refund) => {
        const { currency, amount, netId, deposit } = parseNote(noteString)
        await init({ rpc: program.rpc, noteNetId: netId, currency, amount })
        await withdraw({ deposit, currency, amount, recipient, refund, relayerURL: program.relayer })
      })
    program
      .command('balance <address> [token_address]')
      .description('Check ETH and ERC20 balance')
      .action(async (address, tokenAddress) => {
        await init({ rpc: program.rpc })
        await printETHBalance({ address, name: '' })
        if (tokenAddress) {
          await printERC20Balance({ address, name: '', tokenAddress })
        }
      })
    program
      .command('test')
      .description('Perform an automated test. It deposits and withdraws one ETH and one ERC20 note. Uses ganache.')
      .action(async () => {
        console.log('Start performing ETH deposit-withdraw test')
        let currency = 'eth'
        let amount = '0.1'
        await init({ rpc: program.rpc, currency, amount })
        let noteString = await deposit({ currency, amount })
        let parsedNote = parseNote(noteString)
        await withdraw({ deposit: parsedNote.deposit, currency, amount, recipient: senderAccount, relayerURL: program.relayer })

        console.log('\nStart performing DAI deposit-withdraw test')
        currency = 'dai'
        amount = '100'
        await init({ rpc: program.rpc, currency, amount })
        noteString = await deposit({ currency, amount })
        ;(parsedNote = parseNote(noteString))
        await withdraw({ deposit: parsedNote.deposit, currency, amount, recipient: senderAccount, refund: '0.02', relayerURL: program.relayer })
      })
    try {
      await program.parseAsync(process.argv)
    } catch(e) {
      console.log('Error:', e)
      process.exit(1)
    }
    process.exit(0)
  }
}

main()
