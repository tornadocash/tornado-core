const fs = require('fs')
const assert = require('assert')
const { bigInt } = require('snarkjs')
const crypto = require('crypto')
const circomlib = require('circomlib')
const merkleTree = require('./lib/MerkleTree')
const Web3 = require('web3')
const buildGroth16 = require('websnark/src/groth16')
const websnarkUtils = require('websnark/src/utils')
const { toWei } = require('web3-utils')

let web3, contract, netId, circuit, proving_key, groth16
const RPC_URL = 'http://localhost:8545'
const CONTRACT_ADDRESS = '0x9561C133DD8580860B6b7E504bC5Aa500f0f06a7'
const MERKLE_TREE_HEIGHT = 20
const AMOUNT = '0.1'
const DEPLOYED_BLOCK = 0

/** Generate random number of specified byte length */
const rbigint = nbytes => bigInt.leBuff2int(crypto.randomBytes(nbytes))

/** Compute pedersen hash */
const pedersenHash = data => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/** BigNumber to hex string of specified length */
const toHex = (number, length = 32) => '0x' + (number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)).padStart(length * 2, '0')

/**
 * Create deposit object from secret and nullifier
 */
function createDeposit(nullifier, secret) {
  let deposit = { nullifier, secret }
  deposit.preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(deposit.preimage)
  deposit.nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31))
  return deposit
}

/**
 * Make an ETH deposit
 */
async function deposit() {
  const deposit = createDeposit(rbigint(31), rbigint(31))
  console.log('Sending deposit transaction...')
  await contract.methods.deposit(toHex(deposit.commitment)).send({ value: toWei(AMOUNT), from: web3.eth.defaultAccount, gas:2e6 })
  return `tornado-eth-${AMOUNT}-${netId}-${toHex(deposit.preimage, 62)}`
}

/**
 * Do an ETH withdrawal
 * @param note Note to withdraw
 * @param recipient Recipient address
 */
async function withdraw(note, recipient) {
  const deposit = parseNote(note)
  const { proof, args } = await generateSnarkProof(deposit, recipient)
  console.log('Sending withdrawal transaction...')
  await contract.methods.withdraw(proof, ...args).send({ from: web3.eth.defaultAccount, gas: 1e6 })
}

/**
 * Parses Tornado.cash note
 * @param noteString the note
 */
function parseNote(noteString) {
  const noteRegex = /tornado-(?<currency>\w+)-(?<amount>[\d.]+)-(?<netId>\d+)-0x(?<note>[0-9a-fA-F]{124})/g
  const match = noteRegex.exec(noteString)

  // we are ignoring `currency`, `amount`, and `netId` for this minimal example
  const buf = Buffer.from(match.groups.note, 'hex')
  const nullifier = bigInt.leBuff2int(buf.slice(0, 31))
  const secret = bigInt.leBuff2int(buf.slice(31, 62))
  return createDeposit(nullifier, secret)
}

/**
 * Generate merkle tree for a deposit.
 * Download deposit events from the contract, reconstructs merkle tree, finds our deposit leaf
 * in it and generates merkle proof
 * @param deposit Deposit object
 */
async function generateMerkleProof(deposit) {
  console.log('Getting contract state...')
  const events = await contract.getPastEvents('Deposit', { fromBlock: DEPLOYED_BLOCK, toBlock: 'latest' })
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
    .map(e => e.returnValues.commitment)
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves)

  // Find current commitment in the tree
  let depositEvent = events.find(e => e.returnValues.commitment === toHex(deposit.commitment))
  let leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1

  // Validate that our data is correct (optional)
  const isValidRoot = await contract.methods.isKnownRoot(toHex(await tree.root())).call()
  const isSpent = await contract.methods.isSpent(toHex(deposit.nullifierHash)).call()
  assert(isValidRoot === true, 'Merkle tree is corrupted')
  assert(isSpent === false, 'The note is already spent')
  assert(leafIndex >= 0, 'The deposit is not found in the tree')

  // Compute merkle proof of our commitment
  return await tree.path(leafIndex)
}

/**
 * Generate SNARK proof for withdrawal
 * @param deposit Deposit object
 * @param recipient Funds recipient
 */
async function generateSnarkProof(deposit, recipient) {
  // Compute merkle proof of our commitment
  const { root, path_elements, path_index } = await generateMerkleProof(deposit)

  // Prepare circuit input
  const input = {
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHash,
    recipient: bigInt(recipient),
    relayer: 0,
    fee: 0,
    refund: 0,

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndices: path_index,
  }

  console.log('Generating SNARK proof...')
  const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
  const { proof } = websnarkUtils.toSolidityInput(proofData)

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

async function main() {
  web3 = new Web3(new Web3.providers.HttpProvider(RPC_URL, { timeout: 5 * 60 * 1000 }), null, { transactionConfirmationBlocks: 1 })
  circuit = require('./build/circuits/withdraw.json')
  proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
  groth16 = await buildGroth16()
  netId = await web3.eth.net.getId()
  contract = new web3.eth.Contract(require('./build/contracts/ETHTornado.json').abi, CONTRACT_ADDRESS)
  web3.eth.defaultAccount = (await web3.eth.getAccounts())[0]

  const note = await deposit()
  console.log('Deposited note:', note)
  await withdraw(note, web3.eth.defaultAccount)
  console.log('Done')
  process.exit()
}

main()
