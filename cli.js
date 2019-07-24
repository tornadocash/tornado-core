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

let web3, mixer, circuit, proving_key, groth16
let MERKLE_TREE_HEIGHT, AMOUNT, EMPTY_ELEMENT
const inBrowser = (typeof window !== 'undefined')

const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))
const pedersenHash = (data) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

function createDeposit(nullifier, secret) {
  let deposit = { nullifier, secret }
  deposit.preimage = Buffer.concat([deposit.nullifier.leInt2Buff(32), deposit.secret.leInt2Buff(32)])
  deposit.commitment = pedersenHash(deposit.preimage)
  return deposit
}

async function deposit() {
  const deposit = createDeposit(rbigint(31), rbigint(31))

  console.log('Submitting deposit transaction')
  await mixer.methods.deposit('0x' + deposit.commitment.toString(16)).send({ value: AMOUNT, from: (await web3.eth.getAccounts())[0], gas:1e6 })

  const note = '0x' + deposit.preimage.toString('hex')
  console.log('Your note:', note)
  return note
}

async function getBalance(receiver) {
  const balance = await web3.eth.getBalance(receiver)
  console.log('Balance is ', web3.utils.fromWei(balance))
}

async function withdraw(note, receiver) {
  let buf = Buffer.from(note.slice(2), 'hex')
  let deposit = createDeposit(bigInt.leBuff2int(buf.slice(0, 32)), bigInt.leBuff2int(buf.slice(32, 64)))

  console.log('Getting current state from mixer contract')
  const events = await mixer.getPastEvents('Deposit', { fromBlock: mixer.deployedBlock, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex.sub(b.returnValues.leafIndex))
    .map(e => e.returnValues.commitment)
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, EMPTY_ELEMENT, leaves)
  const validRoot = await mixer.methods.isKnownRoot(await tree.root()).call()
  // todo make sure that function input is 32 bytes long
  const isSpent = await mixer.methods.isSpent('0x' + deposit.nullifier.toString(16)).call()
  assert(validRoot === true)
  assert(isSpent === false)

  const leafIndex = leaves.map(el => el.toString()).indexOf(deposit.commitment.toString())
  assert(leafIndex >= 0)
  const { root, path_elements, path_index } = await tree.path(leafIndex)
  // Circuit input
  const input = {
    // public
    root: root,
    nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(32)),
    receiver: bigInt(receiver),
    fee: bigInt(0),

    // private
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndex: path_index,
  }

  console.log('Generating SNARK proof')
  console.time('Proof time')
  const proof = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
  const { pi_a, pi_b, pi_c, publicSignals } = websnarkUtils.toSolidityInput(proof)
  console.timeEnd('Proof time')

  console.log('Submitting withdraw transaction')
  await mixer.methods.withdraw(pi_a, pi_b, pi_c, publicSignals).send({ from: (await web3.eth.getAccounts())[0], gas: 1e6 })
  console.log('Done')
}

async function init() {
  let contractJson
  if (inBrowser) {
    web3 = new Web3(window.web3.currentProvider, null, { transactionConfirmationBlocks: 1 })
    contractJson = await (await fetch('build/contracts/Mixer.json')).json()
    circuit = await (await fetch('build/circuits/withdraw.json')).json()
    proving_key = await (await fetch('build/circuits/withdraw_proving_key.bin')).arrayBuffer()
    MERKLE_TREE_HEIGHT = 16
    AMOUNT = 1e18
    EMPTY_ELEMENT = 0
  } else {
    web3 = new Web3('http://localhost:8545', null, { transactionConfirmationBlocks: 1 })
    contractJson = require('./build/contracts/Mixer.json')
    circuit = require('./build/circuits/withdraw.json')
    proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
    require('dotenv').config()
    MERKLE_TREE_HEIGHT = process.env.MERKLE_TREE_HEIGHT
    AMOUNT = process.env.AMOUNT
    EMPTY_ELEMENT = process.env.EMPTY_ELEMENT
  }
  groth16 = await buildGroth16()
  let netId = await web3.eth.net.getId()
  const tx = await web3.eth.getTransaction(contractJson.networks[netId].transactionHash)
  mixer = new web3.eth.Contract(contractJson.abi, contractJson.networks[netId].address)
  mixer.deployedBlock = tx.blockNumber
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
    case 'balance':
      if (args.length === 2 && /^0x[0-9a-fA-F]{40}$/.test(args[1])) {
        init().then(() => getBalance(args[1])).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)})
      } else
        printHelp(1)
      break
    case 'withdraw':
      if (args.length === 3 && /^0x[0-9a-fA-F]{128}$/.test(args[1]) && /^0x[0-9a-fA-F]{40}$/.test(args[2])) {
        init().then(() => withdraw(args[1], args[2])).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)})
      }
      else
        printHelp(1)
      break

    default:
      printHelp(1)
    }
  }
}
