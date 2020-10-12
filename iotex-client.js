#!/usr/bin/env node
// Temporary demo client
// Works both in browser and node.js
require('dotenv').config()
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
const { sha3, toWei, fromWei, toBN, BN, hexToBytes } = require('web3-utils')
const config = require('./config')
const program = require('commander')
const linker = require('solc/linker');
const Antenna = require('iotex-antenna')
const Address = require('iotex-antenna/lib/crypto/address')
const Web3EthAbi = require('web3-eth-abi');

let circuit, proving_key, groth16, senderAccount, netId, tornadoAddress, deloyedBlkHeight, currency, amount
let MERKLE_TREE_HEIGHT, IOTX_AMOUNT

let Provider, IOTXTornado, ContractJson

/** Whether we are in a browser or node.js */
const inBrowser = (typeof window !== 'undefined')
let isLocalRPC = false

/** Generate random number of specified byte length */
const rbigint = nbytes => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))

/** Compute pedersen hash */
const pedersenHash = data => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/** BigNumber to hex string of specified length */
function toHex(number, length = 32) {
  const str = number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)
  return '0x' + str.padStart(length * 2, '0')
}

/**
 * Create deposit object from secret and nullifier
 */
function createDeposit({ nullifier, secret }) {
  const deposit = { nullifier, secret }
  deposit.preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(deposit.preimage)
  deposit.commitmentHex = toHex(deposit.commitment)
  deposit.nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31))
  deposit.nullifierHex = toHex(deposit.nullifierHash)
  return deposit
}

/**
 * Make a deposit
 * @param currency Сurrency
 * @param amount Deposit amount
 */
async function deposit() {
  const deposit = createDeposit({ nullifier: rbigint(31), secret: rbigint(31) })
  console.log("commitment:", toHex(deposit.commitment));
  console.log('Submitting deposit transaction')
  actionHash = await IOTXTornado.methods.deposit(toHex(deposit.commitment), {
    account: senderAccount, 
    amount: IOTX_AMOUNT,
  })
  const note = toHex(deposit.preimage, 62)
  const noteString = `tornado-${currency}-${amount}-${netId}-${note}`
  console.log(`Your note: ${noteString}`)
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
  const topicBytes = sha3("Deposit(bytes32,uint32,uint256)")
  const res = await Provider.getLogs({
    filter: {
      address: [tornadoAddress],
      topics:  [
        {  topic: [Buffer.from(topicBytes.substring(2, topicBytes.length), "hex")] }
        ],
    },
    byRange: {
      fromBlock: deloyedBlkHeight,
      count: 1000, // this is max size, need workaround in future 
    }
  })
  const logs = res.logs
  var events = []

   for (let l of logs) {
      let decoded = Web3EthAbi.decodeLog([
        {
          "indexed": true,
          "internalType": "bytes32",
          "name": "commitment",
          "type": "bytes32"
        },
        {
          "indexed": false,
          "internalType": "uint32",
          "name": "leafIndex",
          "type": "uint32"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "timestamp",
          "type": "uint256"
        }
      ], 
      l.data.toString('hex'),
      [l.topics[1].toString('hex')]
    )
    decoded.commitment = '0x' + decoded.commitment
    events.push(decoded)
   }
  
   const leaves = events
   .sort((a, b) => a.leafIndex - b.leafIndex) // Sort events in chronological order
   .map(e => e.commitment)
   const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves)
  // Find current commitment in the tree
  console.log(toHex(deposit.commitment))
  const depositEvent = events.find(e => e.commitment === toHex(deposit.commitment))
  const leafIndex = depositEvent ? depositEvent.leafIndex : -1

  // Validate that our data is correct
  const root = await tree.root()
  const isValidRoot = await Provider.readContractByMethod({
    from: senderAccount.address,
    contractAddress: tornadoAddress,
    abi: ContractJson.abi, 
    method: "isKnownRoot",
  }, toHex(root));

  const isSpent = await Provider.readContractByMethod({
    from: senderAccount.address,
    contractAddress: tornadoAddress,
    abi: ContractJson.abi, 
    method: "isSpent",
  }, toHex(deposit.nullifierHash));

  assert(isValidRoot === true, 'Merkle tree is corrupted')
  assert(isSpent === false, 'The note is already spent')
  assert(leafIndex >= 0, 'The deposit is not found in the tree')

  // Compute merkle proof of our commitment
  return tree.path(leafIndex)
}

/**
 * Generate SNARK proof for withdrawal
 * @param deposit Deposit object
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

  // eth address -> io address 
  recipientBytes = await hexToBytes(toHex(input.recipient, 20))
  ioRecipient = await Address.fromBytes(recipientBytes)
  relayerBytes = await hexToBytes(toHex(input.relayer, 20))
  ioRelayer = await Address.fromBytes(relayerBytes)  
  const args = [
    proof,
    toHex(input.root),
    toHex(input.nullifierHash),
    ioRecipient.string(),
    ioRelayer.string(),
    toHex(input.fee),
    toHex(input.refund)
  ]

  return { args }
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
    if (relayerURL.endsWith('.eth')) {
      throw new Error('ENS name resolving is not supported. Please provide DNS name of the relayer. See instuctions in README.md')
    }
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
    try {
      const relay = await axios.post(relayerURL + '/relay', { contract: tornado._address, proof, args })
      if (netId === 1 || netId === 42) {
        console.log(`Transaction submitted through the relay. View transaction on etherscan https://${getCurrentNetworkName()}etherscan.io/tx/${relay.data.txHash}`)
      } else {
        console.log(`Transaction submitted through the relay. The transaction hash is ${relay.data.txHash}`)
      }

      const receipt = await waitForTxReceipt({ txHash: relay.data.txHash })
      console.log('Transaction mined in block', receipt.blockNumber)
    } catch (e) {
      if (e.response) {
        console.error(e.response.data.error)
      } else {
        console.error(e.message)
      }
    }
  } else { // using private key
    const { proof, args } = await generateProof({ deposit, recipient, refund })

    console.log('Submitting withdraw transaction')
    await tornado.methods.withdraw(proof, ...args).send({ from: senderAccount, value: refund.toString(), gas: 1e6 })
      .on('transactionHash', function (txHash) {
        if (netId === 1 || netId === 42) {
          console.log(`View transaction on etherscan https://${getCurrentNetworkName()}etherscan.io/tx/${txHash}`)
        } else {
          console.log(`The transaction hash is ${txHash}`)
        }
      }).on('error', function (e) {
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

function toDecimals(value, decimals, fixed) {
  const zero = new BN(0)
  const negative1 = new BN(-1)
  decimals = decimals || 18
  fixed = fixed || 7

  value = new BN(value)
  const negative = value.lt(zero)
  const base = new BN('10').pow(new BN(decimals))
  const baseLength = base.toString(10).length - 1 || 1

  if (negative) {
    value = value.mul(negative1)
  }

  let fraction = value.mod(base).toString(10)
  while (fraction.length < baseLength) {
    fraction = `0${fraction}`
  }
  fraction = fraction.match(/^([0-9]*[1-9]|0)(0*)/)[1]

  const whole = value.div(base).toString(10)
  value = `${whole}${fraction === '0' ? '' : `.${fraction}`}`

  if (negative) {
    value = `-${value}`
  }

  if (fixed) {
    value = value.slice(0, fixed)
  }

  return value
}

function calculateFee({ gasPrices, currency, amount, refund, ethPrices, relayerServiceFee, decimals }) {
  const decimalsPoint = Math.floor(relayerServiceFee) === Number(relayerServiceFee) ?
    0 :
    relayerServiceFee.toString().split('.')[1].length
  const roundDecimal = 10 ** decimalsPoint
  const total = toBN(fromDecimals({ amount, decimals }))
  const feePercent = total.mul(toBN(relayerServiceFee * roundDecimal)).div(toBN(roundDecimal * 100))
  const expense = toBN(toWei(gasPrices.fast.toString(), 'gwei')).mul(toBN(5e5))
  let desiredFee
  switch (currency) {
  case 'eth': {
    desiredFee = expense.add(feePercent)
    break
  }
  default: {
    desiredFee = expense.add(toBN(refund))
      .mul(toBN(10 ** decimals))
      .div(toBN(ethPrices[currency]))
    desiredFee = desiredFee.add(feePercent)
    break
  }
  }
  return desiredFee
}


function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
async function init() {
  tornadoAddress = "io1qlkcywx7tkqetccm28dy52fgexqcxa4l75ntnm"
  deloyedBlkHeight = 5902770
  MERKLE_TREE_HEIGHT = process.env.MERKLE_TREE_HEIGHT || 20
  ContractJson = require('./build/contracts/ETHTornado.json')
  circuit = require('./build/circuits/withdraw.json')
  proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
  Provider = new Antenna.default.modules.Iotx("http://api.testnet.iotex.one:80");
  IOTXTornado = new Antenna.default.modules.Contract (
    ContractJson.abi, 
    tornadoAddress,
    {
      provider:  Provider,
    }
  )
  groth16 = await buildGroth16()
  currency = 'iotx'
  amount = '1'
  netId = '1'
  IOTX_AMOUNT = process.env.IOTX_AMOUNT || 1000000000000000000
  senderAccount = Provider.accounts.privateKeyToAccount(
    "51b7ef3cb87f73d8c5b65858ecfac791239c33103c2968dd5ec6716e62ae8ea1"
  );
}

async function deploy() {
  //deploy after linking with hasher contract (print out bytecode)
  var byteCode = ContractJson.bytecode
  verifierContractAddress = "io1fxz85k4em9nmwea249jztflx5dpmxgaz6syl8n"
  byteCode = linker.linkBytecode(
    byteCode, {
      'Hasher': '0x36090A0F41dd8785f96B48A71871881E0868B26c'
    })
  actionHash = await Provider.deployContract(
  {
    from: senderAccount.address,
    abi: ContractJson.abi,
    data: Buffer.from(byteCode.substring(2, byteCode.length), "hex"),
  }, verifierContractAddress , IOTX_AMOUNT, MERKLE_TREE_HEIGHT, senderAccount.address);
  console.log("action hash:", actionHash)
}

async function main() {
  program
    .option('-r, --rpc <URL>', 'The RPC, CLI should interact with', 'http://localhost:8545')
    .option('-R, --relayer <URL>', 'Withdraw via relayer')
  program
    .command('deploy')
    .description('Submit a deposit of specified currency and amount from default eth account and return the resulting note. The currency is one of (ETH|DAI|cDAI|USDC|cUSDC|USDT). The amount depends on currency, see config.js file or visit https://tornado.cash.')
    .action(async () => {
      await init();
      await deploy();
      process.exit(0)
    }) 
  program
    .command('test')
    .description('dd')
    .action(async () => {
      await init();
      noteString = await deposit();
      await sleep(15000);

      let parsedNote = parseNote(noteString)
      recipient = '0x53FBC28FAF9a52dFe5F591948A23189E900381B5'
      const { args } = await generateProof({ deposit: parsedNote.deposit, recipient})
      console.log('args:', args)

      console.log('Submitting withdraw transaction')
      actionHash = await IOTXTornado.methods.withdraw(...args, {
        account: senderAccount, 
        gasLimit: "1000000",
        gasPrice: "1000000000000",
        amount: "0",
      })
      console.log(actionHash)
      console.log("done")
      process.exit(0)
    })
    try {
      await program.parseAsync(process.argv)
      process.exit(0)
    } catch (e) {
      console.log('Error:', e)
      process.exit(1)
    }
}
main()
