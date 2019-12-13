/* global artifacts, web3, contract */
require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()
const fs = require('fs')

const { toBN, randomHex } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('../lib/ganacheHelper')

const Tornado = artifacts.require('./ETHTornado.sol')
const { ETH_AMOUNT, MERKLE_TREE_HEIGHT } = process.env

const websnarkUtils = require('websnark/src/utils')
const buildGroth16 = require('websnark/src/groth16')
const stringifyBigInts = require('websnark/tools/stringifybigint').stringifyBigInts
const unstringifyBigInts2 = require('snarkjs/src/stringifybigint').unstringifyBigInts
const snarkjs = require('snarkjs')
const bigInt = snarkjs.bigInt
const crypto = require('crypto')
const circomlib = require('circomlib')
const MerkleTree = require('../lib/MerkleTree')

const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))
const pedersenHash = (data) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]
const toFixedHex = (number, length = 32) =>  '0x' + bigInt(number).toString(16).padStart(length * 2, '0')
const getRandomRecipient = () => rbigint(20)

function generateDeposit() {
  let deposit = {
    secret: rbigint(31),
    nullifier: rbigint(31),
  }
  const preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(preimage)
  return deposit
}

// eslint-disable-next-line no-unused-vars
function BNArrayToStringArray(array) {
  const arrayToPrint = []
  array.forEach(item => {
    arrayToPrint.push(item.toString())
  })
  return arrayToPrint
}

function snarkVerify(proof) {
  proof = unstringifyBigInts2(proof)
  const verification_key = unstringifyBigInts2(require('../build/circuits/withdraw_verification_key.json'))
  return snarkjs['groth'].isValid(verification_key, proof, proof.publicSignals)
}

contract('ETHTornado', accounts => {
  let tornado
  const sender = accounts[0]
  const operator = accounts[0]
  const levels = MERKLE_TREE_HEIGHT || 16
  const value = ETH_AMOUNT || '1000000000000000000' // 1 ether
  let snapshotId
  let prefix = 'test'
  let tree
  const fee = bigInt(ETH_AMOUNT).shr(1) || bigInt(1e17)
  const refund = bigInt(0)
  const recipient = getRandomRecipient()
  const relayer = accounts[1]
  let groth16
  let circuit
  let proving_key

  before(async () => {
    tree = new MerkleTree(
      levels,
      null,
      prefix,
    )
    tornado = await Tornado.deployed()
    snapshotId = await takeSnapshot()
    groth16 = await buildGroth16()
    circuit = require('../build/circuits/withdraw.json')
    proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const etherDenomination = await tornado.denomination()
      etherDenomination.should.be.eq.BN(toBN(value))
    })
  })

  describe('#deposit', () => {
    it('should emit event', async () => {
      let commitment = toFixedHex(42)
      let { logs } = await tornado.deposit(commitment, { value, from: sender })

      logs[0].event.should.be.equal('Deposit')
      logs[0].args.commitment.should.be.equal(commitment)
      logs[0].args.leafIndex.should.be.eq.BN(0)

      commitment = toFixedHex(12);
      ({ logs } = await tornado.deposit(commitment, { value, from: accounts[2] }))

      logs[0].event.should.be.equal('Deposit')
      logs[0].args.commitment.should.be.equal(commitment)
      logs[0].args.leafIndex.should.be.eq.BN(1)
    })

    it('should throw if there is a such commitment', async () => {
      const commitment = toFixedHex(42)
      await tornado.deposit(commitment, { value, from: sender }).should.be.fulfilled
      const error = await tornado.deposit(commitment, { value, from: sender }).should.be.rejected
      error.reason.should.be.equal('The commitment has been submitted')
    })
  })

  describe('snark proof verification on js side', () => {
    it('should detect tampering', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      const { root, path_elements, path_index } = await tree.path(0)

      const input = stringifyBigInts({
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        nullifier: deposit.nullifier,
        relayer: operator,
        recipient,
        fee,
        refund,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })

      let proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const originalProof = JSON.parse(JSON.stringify(proofData))
      let result = snarkVerify(proofData)
      result.should.be.equal(true)

      // nullifier
      proofData.publicSignals[1] = '133792158246920651341275668520530514036799294649489851421007411546007850802'
      result = snarkVerify(proofData)
      result.should.be.equal(false)
      proofData = originalProof

      // try to cheat with recipient
      proofData.publicSignals[2] = '133738360804642228759657445999390850076318544422'
      result = snarkVerify(proofData)
      result.should.be.equal(false)
      proofData = originalProof

      // fee
      proofData.publicSignals[3] = '1337100000000000000000'
      result = snarkVerify(proofData)
      result.should.be.equal(false)
      proofData = originalProof
    })
  })

  describe('#withdraw', () => {
    it('should work', async () => {
      const deposit = generateDeposit()
      const user = accounts[4]
      await tree.insert(deposit.commitment)

      const balanceUserBefore = await web3.eth.getBalance(user)

      // Uncomment to measure gas usage
      // let gas = await tornado.deposit.estimateGas(toBN(deposit.commitment.toString()), { value, from: user, gasPrice: '0' })
      // console.log('deposit gas:', gas)
      await tornado.deposit(toFixedHex(deposit.commitment), { value, from: user, gasPrice: '0' })

      const balanceUserAfter = await web3.eth.getBalance(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(value)))

      const { root, path_elements, path_index } = await tree.path(0)

      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer: operator,
        recipient,
        fee,
        refund,

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })


      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const balanceTornadoBefore = await web3.eth.getBalance(tornado.address)
      const balanceRelayerBefore = await web3.eth.getBalance(relayer)
      const balanceOperatorBefore = await web3.eth.getBalance(operator)
      const balanceRecieverBefore = await web3.eth.getBalance(toFixedHex(recipient, 20))
      let isSpent = await tornado.isSpent(toFixedHex(input.nullifierHash))
      isSpent.should.be.equal(false)

      // Uncomment to measure gas usage
      // gas = await tornado.withdraw.estimateGas(proof, publicSignals, { from: relayer, gasPrice: '0' })
      // console.log('withdraw gas:', gas)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const { logs } = await tornado.withdraw(proof, ...args, { from: relayer, gasPrice: '0' })

      const balanceTornadoAfter = await web3.eth.getBalance(tornado.address)
      const balanceRelayerAfter = await web3.eth.getBalance(relayer)
      const balanceOperatorAfter = await web3.eth.getBalance(operator)
      const balanceRecieverAfter = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const feeBN = toBN(fee.toString())
      balanceTornadoAfter.should.be.eq.BN(toBN(balanceTornadoBefore).sub(toBN(value)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore))
      balanceOperatorAfter.should.be.eq.BN(toBN(balanceOperatorBefore).add(feeBN))
      balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(value)).sub(feeBN))


      logs[0].event.should.be.equal('Withdrawal')
      logs[0].args.nullifierHash.should.be.equal(toFixedHex(input.nullifierHash))
      logs[0].args.relayer.should.be.eq.BN(operator)
      logs[0].args.fee.should.be.eq.BN(feeBN)
      isSpent = await tornado.isSpent(toFixedHex(input.nullifierHash))
      isSpent.should.be.equal(true)
    })

    it('should prevent double spend', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await tornado.deposit(toFixedHex(deposit.commitment), { value, from: sender })

      const { root, path_elements, path_index } = await tree.path(0)

      const input = stringifyBigInts({
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        nullifier: deposit.nullifier,
        relayer: operator,
        recipient,
        fee,
        refund,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })
      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      await tornado.withdraw(proof, ...args, { from: relayer }).should.be.fulfilled
      const error = await tornado.withdraw(proof, ...args, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('The note has been already spent')
    })

    it('should prevent double spend with overflow', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await tornado.deposit(toFixedHex(deposit.commitment), { value, from: sender })

      const { root, path_elements, path_index } = await tree.path(0)

      const input = stringifyBigInts({
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        nullifier: deposit.nullifier,
        relayer: operator,
        recipient,
        fee,
        refund,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })
      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)
      const args = [
        toFixedHex(input.root),
        toFixedHex(toBN(input.nullifierHash).add(toBN('21888242871839275222246405745257275088548364400416034343698204186575808495617'))),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const error = await tornado.withdraw(proof, ...args, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('verifier-gte-snark-scalar-field')
    })

    it('fee should be less or equal transfer value', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await tornado.deposit(toFixedHex(deposit.commitment), { value, from: sender })

      const { root, path_elements, path_index } = await tree.path(0)
      const largeFee = bigInt(value).add(bigInt(1))
      const input = stringifyBigInts({
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        nullifier: deposit.nullifier,
        relayer: operator,
        recipient,
        fee: largeFee,
        refund,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })

      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const error = await tornado.withdraw(proof, ...args, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('Fee exceeds transfer value')
    })

    it('should throw for corrupted merkle tree root', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await tornado.deposit(toFixedHex(deposit.commitment), { value, from: sender })

      const { root, path_elements, path_index } = await tree.path(0)

      const input = stringifyBigInts({
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        root,
        nullifier: deposit.nullifier,
        relayer: operator,
        recipient,
        fee,
        refund,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })

      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const args = [
        toFixedHex(randomHex(32)),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const error = await tornado.withdraw(proof, ...args, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('Cannot find your merkle root')
    })

    it('should reject with tampered public inputs', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await tornado.deposit(toFixedHex(deposit.commitment), { value, from: sender })

      let { root, path_elements, path_index } = await tree.path(0)

      const input = stringifyBigInts({
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        nullifier: deposit.nullifier,
        relayer: operator,
        recipient,
        fee,
        refund,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })
      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      let { proof } = websnarkUtils.toSolidityInput(proofData)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      let incorrectArgs
      const originalProof = proof.slice()

      // recipient
      incorrectArgs = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex('0x0000000000000000000000007a1f9131357404ef86d7c38dbffed2da70321337', 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      let error = await tornado.withdraw(proof, ...incorrectArgs, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('Invalid withdraw proof')

      // fee
      incorrectArgs = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex('0x000000000000000000000000000000000000000000000000015345785d8a0000'),
        toFixedHex(input.refund)
      ]
      error = await tornado.withdraw(proof, ...incorrectArgs, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('Invalid withdraw proof')

      // nullifier
      incorrectArgs = [
        toFixedHex(input.root),
        toFixedHex('0x00abdfc78211f8807b9c6504a6e537e71b8788b2f529a95f1399ce124a8642ad'),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      error = await tornado.withdraw(proof, ...incorrectArgs, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('Invalid withdraw proof')

      // proof itself
      proof = '0xbeef' + proof.substr(6)
      await tornado.withdraw(proof, ...args, { from: relayer }).should.be.rejected

      // should work with original values
      await tornado.withdraw(originalProof, ...args, { from: relayer }).should.be.fulfilled
    })

    it('should reject with non zero refund', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await tornado.deposit(toFixedHex(deposit.commitment), { value, from: sender })

      const { root, path_elements, path_index } = await tree.path(0)

      const input = stringifyBigInts({
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        root,
        nullifier: deposit.nullifier,
        relayer: operator,
        recipient,
        fee,
        refund: bigInt(1),
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })

      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const error = await tornado.withdraw(proof, ...args, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('Refund value is supposed to be zero for ETH instance')
    })
  })

  describe('#changeOperator', () => {
    it('should work', async () => {
      let operator = await tornado.operator()
      operator.should.be.equal(sender)

      const newOperator = accounts[7]
      await tornado.changeOperator(newOperator).should.be.fulfilled

      operator = await tornado.operator()
      operator.should.be.equal(newOperator)
    })

    it('cannot change from different address', async () => {
      let operator = await tornado.operator()
      operator.should.be.equal(sender)

      const newOperator = accounts[7]
      const error = await tornado.changeOperator(newOperator, { from:  accounts[7] }).should.be.rejected
      error.reason.should.be.equal('Only operator can call this function.')

    })
  })

  describe('#updateVerifier', () => {
    it('should work', async () => {
      let operator = await tornado.operator()
      operator.should.be.equal(sender)

      const newVerifier = accounts[7]
      await tornado.updateVerifier(newVerifier).should.be.fulfilled

      const verifier = await tornado.verifier()
      verifier.should.be.equal(newVerifier)
    })

    it('cannot change from different address', async () => {
      let operator = await tornado.operator()
      operator.should.be.equal(sender)

      const newVerifier = accounts[7]
      const error = await tornado.updateVerifier(newVerifier, { from:  accounts[7] }).should.be.rejected
      error.reason.should.be.equal('Only operator can call this function.')

    })
  })

  describe('#isSpent', () => {
    it('should work', async () => {
      const deposit1 = generateDeposit()
      const deposit2 = generateDeposit()
      await tree.insert(deposit1.commitment)
      await tree.insert(deposit2.commitment)
      await tornado.deposit(toFixedHex(deposit1.commitment), { value, gasPrice: '0' })
      await tornado.deposit(toFixedHex(deposit2.commitment), { value, gasPrice: '0' })

      const { root, path_elements, path_index } = await tree.path(1)

      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit2.nullifier.leInt2Buff(31)),
        relayer: operator,
        recipient,
        fee,
        refund,

        // private
        nullifier: deposit2.nullifier,
        secret: deposit2.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })


      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]

      await tornado.withdraw(proof, ...args, { from: relayer, gasPrice: '0' })

      const nullifierHash1 = toFixedHex(pedersenHash(deposit1.nullifier.leInt2Buff(31)))
      const nullifierHash2 = toFixedHex(pedersenHash(deposit2.nullifier.leInt2Buff(31)))
      const spentArray = await tornado.isSpentArray([nullifierHash1, nullifierHash2])
      spentArray.should.be.deep.equal([false, true])
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    // eslint-disable-next-line require-atomic-updates
    snapshotId = await takeSnapshot()
    tree = new MerkleTree(
      levels,
      null,
      prefix,
    )
  })
})
