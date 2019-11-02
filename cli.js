#!/usr/bin/env node
// Temporary demo client
// Works both in browser and node.js
const fs = require('fs')
const assert = require('assert')
const snarkjs = require('snarkjs')
const crypto = require('crypto')
const circomlib = require('circomlib')
const bigInt = snarkjs.bigInt
const merkleTree = require('./lib/MerkleTree')
const Web3 = require('web3')
const buildGroth16 = require('websnark/src/groth16')
const websnarkUtils = require('websnark/src/utils')

let web3, mixer, erc20mixer, circuit, proving_key, groth16, erc20
let MERKLE_TREE_HEIGHT, ETH_AMOUNT, ERC20_TOKEN
const inBrowser = (typeof window !== 'undefined')

/** Generate random number of specified byte length */
const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))

/** Compute pedersen hash */
const pedersenHash = (data) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/**
 * Create deposit object from secret and nullifier
 */
function createDeposit(nullifier, secret) {
  let deposit = { nullifier, secret }
  deposit.preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(deposit.preimage)
  return deposit
}

/**
 * Make a deposit
 * @returns {Promise<string>}
 */
async function deposit() {
  const deposit = createDeposit(rbigint(31), rbigint(31))

  console.log('Submitting deposit transaction')
  await mixer.methods.deposit('0x' + deposit.commitment.toString(16)).send({ value: ETH_AMOUNT, from: (await web3.eth.getAccounts())[0], gas:1e6 })

  const note = '0x' + deposit.preimage.toString('hex')
  console.log('Your note:', note)
  return note
}

async function depositErc20() {
  const account = (await web3.eth.getAccounts())[0]
  const tokenAmount = process.env.TOKEN_AMOUNT
  await erc20.methods.mint(account, tokenAmount).send({ from: account, gas:1e6 })

  await erc20.methods.approve(erc20mixer.address, tokenAmount).send({ from: account, gas:1e6 })
  const allowance = await erc20.methods.allowance(account, erc20mixer.address).call()
  console.log('erc20mixer allowance', allowance.toString(10))

  const deposit = createDeposit(rbigint(31), rbigint(31))
  await erc20mixer.methods.deposit('0x' + deposit.commitment.toString(16)).send({ value: ETH_AMOUNT, from: account, gas:1e6 })

  const balance = await erc20.methods.balanceOf(erc20mixer.address).call()
  console.log('erc20mixer balance', balance.toString(10))
  const note = '0x' + deposit.preimage.toString('hex')
  console.log('Your note:', note)
  return note
}

async function withdrawErc20(note, receiver, relayer) {
  let buf = Buffer.from(note.slice(2), 'hex')
  let deposit = createDeposit(bigInt.leBuff2int(buf.slice(0, 31)), bigInt.leBuff2int(buf.slice(31, 62)))

  console.log('Getting current state from mixer contract')
  const events = await erc20mixer.getPastEvents('Deposit', { fromBlock: erc20mixer.deployedBlock, toBlock: 'latest' })
  let leafIndex

  const commitment = deposit.commitment.toString(16).padStart('66', '0x000000')
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex.sub(b.returnValues.leafIndex))
    .map(e => {
      if (e.returnValues.commitment.eq(commitment)) {
        leafIndex = e.returnValues.leafIndex.toNumber()
      }
      return e.returnValues.commitment
    })
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves)
  const validRoot = await erc20mixer.methods.isKnownRoot(await tree.root()).call()
  const nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31))
  const nullifierHashToCheck = nullifierHash.toString(16).padStart('66', '0x000000')
  const isSpent = await erc20mixer.methods.isSpent(nullifierHashToCheck).call()
  assert(validRoot === true)
  assert(isSpent === false)

  assert(leafIndex >= 0)
  const { root, path_elements, path_index } = await tree.path(leafIndex)
  // Circuit input
  const input = {
    // public
    root: root,
    nullifierHash,
    receiver: bigInt(receiver),
    relayer: bigInt(relayer),
    fee: bigInt(web3.utils.toWei('0.01')),
    refund: bigInt(0),

    // private
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndex: path_index,
  }

  console.log('Generating SNARK proof')
  console.time('Proof time')
  const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
  const { proof, publicSignals } = websnarkUtils.toSolidityInput(proofData)
  console.timeEnd('Proof time')

  console.log('Submitting withdraw transaction')
  await erc20mixer.methods.withdraw(proof, publicSignals).send({ from: (await web3.eth.getAccounts())[0], gas: 1e6 })
  console.log('Done')
}

async function getBalance(receiver) {
  const balance = await web3.eth.getBalance(receiver)
  console.log('Balance is ', web3.utils.fromWei(balance))
}

async function getBalanceErc20(receiver, relayer) {
  const balanceReceiver = await web3.eth.getBalance(receiver)
  const balanceRelayer = await web3.eth.getBalance(relayer)
  const tokenBalanceReceiver = await erc20.methods.balanceOf(receiver).call()
  const tokenBalanceRelayer = await erc20.methods.balanceOf(relayer).call()
  console.log('Receiver eth Balance is ', web3.utils.fromWei(balanceReceiver))
  console.log('Relayer eth Balance is ', web3.utils.fromWei(balanceRelayer))

  console.log('Receiver token Balance is ', web3.utils.fromWei(tokenBalanceReceiver.toString()))
  console.log('Relayer token Balance is ', web3.utils.fromWei(tokenBalanceRelayer.toString()))
}

async function withdraw(note, receiver) {
  // Decode hex string and restore the deposit object
  let buf = Buffer.from(note.slice(2), 'hex')
  let deposit = createDeposit(bigInt.leBuff2int(buf.slice(0, 31)), bigInt.leBuff2int(buf.slice(31, 62)))
  const nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31))
  const paddedNullifierHash = nullifierHash.toString(16).padStart('66', '0x000000')
  const paddedCommitment = deposit.commitment.toString(16).padStart('66', '0x000000')

  // Get all deposit events from smart contract and assemble merkle tree from them
  console.log('Getting current state from mixer contract')
  const events = await mixer.getPastEvents('Deposit', { fromBlock: mixer.deployedBlock, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex.sub(b.returnValues.leafIndex)) // Sort events in chronological order
    .map(e => e.returnValues.commitment)
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves)

  // Find current commitment in the tree
  let depositEvent = events.find(e => e.returnValues.commitment.eq(paddedCommitment))
  let leafIndex = depositEvent ? depositEvent.returnValues.leafIndex.toNumber() : -1

  // Validate that our data is correct
  const isValidRoot = await mixer.methods.isKnownRoot(await tree.root()).call()
  const isSpent = await mixer.methods.isSpent(paddedNullifierHash).call()
  assert(isValidRoot === true) // Merkle tree assembled correctly
  assert(isSpent === false)    // The note is not spent
  assert(leafIndex >= 0)       // Our deposit is present in the tree

  // Compute merkle proof of our commitment
  const { root, path_elements, path_index } = await tree.path(leafIndex)

  // Prepare circuit input
  const input = {
    // Public snark inputs
    root: root,
    nullifierHash,
    receiver: bigInt(receiver),
    relayer: bigInt(0),
    fee: bigInt(0),
    refund: bigInt(0),

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndex: path_index,
  }

  console.log('Generating SNARK proof')
  console.time('Proof time')
  const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
  const { proof, publicSignals } = websnarkUtils.toSolidityInput(proofData)
  console.timeEnd('Proof time')

  console.log('Submitting withdraw transaction')
  await mixer.methods.withdraw(proof, publicSignals).send({ from: (await web3.eth.getAccounts())[0], gas: 1e6 })
  console.log('Done')
}

/**
 * Init web3, contracts, and snark
 */
async function init() {
  let contractJson, erc20ContractJson, erc20mixerJson
  if (inBrowser) {
    // Initialize using injected web3 (Metamask)
    // To assemble web version run `npm run browserify`
    web3 = new Web3(window.web3.currentProvider, null, { transactionConfirmationBlocks: 1 })
    contractJson = await (await fetch('build/contracts/ETHMixer.json')).json()
    circuit = await (await fetch('build/circuits/withdraw.json')).json()
    proving_key = await (await fetch('build/circuits/withdraw_proving_key.bin')).arrayBuffer()
    MERKLE_TREE_HEIGHT = 16
    ETH_AMOUNT = 1e18
  } else {
    // Initialize from local node
    web3 = new Web3('http://localhost:8545', null, { transactionConfirmationBlocks: 1 })
    contractJson = require('./build/contracts/ETHMixer.json')
    circuit = require('./build/circuits/withdraw.json')
    proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
    require('dotenv').config()
    MERKLE_TREE_HEIGHT = process.env.MERKLE_TREE_HEIGHT
    ETH_AMOUNT = process.env.ETH_AMOUNT
    ERC20_TOKEN = process.env.ERC20_TOKEN
    erc20ContractJson = require('./build/contracts/ERC20Mock.json')
    erc20mixerJson = require('./build/contracts/ERC20Mixer.json')
  }
  groth16 = await buildGroth16()
  let netId = await web3.eth.net.getId()
  if (contractJson.networks[netId]) {
    const tx = await web3.eth.getTransaction(contractJson.networks[netId].transactionHash)
    mixer = new web3.eth.Contract(contractJson.abi, contractJson.networks[netId].address)
    mixer.deployedBlock = tx.blockNumber
  }

  const tx3 = await web3.eth.getTransaction(erc20mixerJson.networks[netId].transactionHash)
  erc20mixer = new web3.eth.Contract(erc20mixerJson.abi, erc20mixerJson.networks[netId].address)
  erc20mixer.deployedBlock = tx3.blockNumber

  if(ERC20_TOKEN === '') {
    erc20 = new web3.eth.Contract(erc20ContractJson.abi, erc20ContractJson.networks[netId].address)
    const tx2 = await web3.eth.getTransaction(erc20ContractJson.networks[netId].transactionHash)
    erc20.deployedBlock = tx2.blockNumber
  }
  console.log('Loaded')
}

// ========== CLI related stuff below ==============

function printHelp(code = 0) {
  console.log(`Usage:
  Submit a deposit from default eth account and return the resulting note
  $ ./cli.js deposit

  Withdraw a note to 'receiver' account
  $ ./cli.js withdraw <note> <receiver>

  Check address balance
  $ ./cli.js balance <address>

Example:
  $ ./cli.js deposit
  ...
  Your note: 0x1941fa999e2b4bfeec3ce53c2440c3bc991b1b84c9bb650ea19f8331baf621001e696487e2a2ee54541fa12f49498d71e24d00b1731a8ccd4f5f5126f3d9f400

  $ ./cli.js withdraw 0x1941fa999e2b4bfeec3ce53c2440c3bc991b1b84c9bb650ea19f8331baf621001e696487e2a2ee54541fa12f49498d71e24d00b1731a8ccd4f5f5126f3d9f400 0xee6249BA80596A4890D1BD84dbf5E4322eA4E7f0
`)
  process.exit(code)
}

if (inBrowser) {
  window.deposit = deposit
  window.withdraw = async () => {
    const note = prompt('Enter the note to withdraw')
    const receiver = (await web3.eth.getAccounts())[0]
    await withdraw(note, receiver)
  }
  init()
} else {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    printHelp()
  } else {
    switch (args[0]) {
    case 'deposit':
      if (args.length === 1) {
        init().then(() => deposit()).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)})
      }
      else
        printHelp(1)
      break
    case 'depositErc20':
      if (args.length === 1) {
        init().then(() => depositErc20()).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)})
      }
      else
        printHelp(1)
      break
    case 'balance':
      if (args.length === 2 && /^0x[0-9a-fA-F]{40}$/.test(args[1])) {
        init().then(() => getBalance(args[1])).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)})
      } else
        printHelp(1)
      break
    case 'balanceErc20':
      if (args.length === 3 && /^0x[0-9a-fA-F]{40}$/.test(args[1]) && /^0x[0-9a-fA-F]{40}$/.test(args[2])) {
        init().then(() => getBalanceErc20(args[1], args[2])).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)})
      } else
        printHelp(1)
      break
    case 'withdraw':
      if (args.length === 3 && /^0x[0-9a-fA-F]{124}$/.test(args[1]) && /^0x[0-9a-fA-F]{40}$/.test(args[2])) {
        init().then(() => withdraw(args[1], args[2])).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)})
      }
      else
        printHelp(1)
      break
    case 'withdrawErc20':
      if (args.length === 4 && /^0x[0-9a-fA-F]{124}$/.test(args[1]) && /^0x[0-9a-fA-F]{40}$/.test(args[2]) && /^0x[0-9a-fA-F]{40}$/.test(args[3])) {
        init().then(() => withdrawErc20(args[1], args[2], args[3])).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)})
      }
      else
        printHelp(1)
      break
    case 'test':
      if (args.length === 1) {
        (async () => {
          await init()
          const account = (await web3.eth.getAccounts())[0]
          const note = await deposit()
          await withdraw(note, account)

          const note2 = await deposit()
          await withdraw(note2, account, account)
          process.exit(0)
        })()
      }
      else
        printHelp(1)
      break

    default:
      printHelp(1)
    }
  }
}
