/* global artifacts, web3, contract */
require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()
const fs = require('fs')

const { toBN, toHex, randomHex } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('../lib/ganacheHelper')

const Mixer = artifacts.require('./ERC20Mixer.sol')
const Token = artifacts.require('./ERC20Mock.sol')
const { AMOUNT, MERKLE_TREE_HEIGHT, EMPTY_ELEMENT } = process.env

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

function getRandomReceiver() {
  let receiver = rbigint(20)
  while (toHex(receiver.toString()).length !== 42) {
    receiver = rbigint(20)
  }
  return receiver
}

function snarkVerify(proof) {
  proof = unstringifyBigInts2(websnarkUtils.fromSolidityInput(proof))
  const verification_key = unstringifyBigInts2(require('../build/circuits/withdraw_verification_key.json'))
  return snarkjs['groth'].isValid(verification_key, proof, proof.publicSignals)
}

contract('Mixer', accounts => {
  let mixer
  let token
  const sender = accounts[0]
  const operator = accounts[0]
  const levels = MERKLE_TREE_HEIGHT || 16
  const zeroValue = EMPTY_ELEMENT || 1337
  const value = AMOUNT || '1000000000000000000' // 1 ether
  let snapshotId
  let prefix = 'test'
  let tree
  const fee = bigInt(AMOUNT).shr(1) || bigInt(1e17)
  const receiver = getRandomReceiver()
  const relayer = accounts[1]
  let groth16
  let circuit
  let proving_key

  before(async () => {
    tree = new MerkleTree(
      levels,
      zeroValue,
      null,
      prefix,
    )
    mixer = await Mixer.deployed()
    token = await Token.deployed()
    await token.mint(sender, value)
    snapshotId = await takeSnapshot()
    groth16 = await buildGroth16()
    circuit = require('../build/circuits/withdraw.json')
    proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const tokenFromContract = await mixer.token()
      tokenFromContract.should.be.equal(token.address)
    })
  })

  describe('#deposit', () => {
    it('should work', async () => {
      const commitment = 43
      await token.approve(mixer.address, value)

      let { logs } = await mixer.deposit(commitment, { from: sender })

      logs[0].event.should.be.equal('Deposit')
      logs[0].args.commitment.should.be.eq.BN(toBN(commitment))
      logs[0].args.leafIndex.should.be.eq.BN(toBN(0))
    })
  })

  describe('#withdraw', () => {
    it('should work', async () => {
      const deposit = generateDeposit()
      const user = accounts[4]
      await tree.insert(deposit.commitment)
      await token.mint(user, value)

      const balanceUserBefore = await token.balanceOf(user)
      await token.approve(mixer.address, value, { from: user })
      // Uncomment to measure gas usage
      // let gas = await mixer.deposit.estimateGas(toBN(deposit.commitment.toString()), { value, from: user, gasPrice: '0' })
      // console.log('deposit gas:', gas)
      await mixer.deposit(toBN(deposit.commitment.toString()), { from: user, gasPrice: '0' })

      const balanceUserAfter = await token.balanceOf(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(value)))

      const { root, path_elements, path_index } = await tree.path(0)

      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        receiver,
        fee,

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndex: path_index,
      })


      const proof = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { pi_a, pi_b, pi_c, publicSignals } = websnarkUtils.toSolidityInput(proof)

      const balanceMixerBefore = await token.balanceOf(mixer.address)
      const balanceRelayerBefore = await token.balanceOf(relayer)
      const balanceOperatorBefore = await token.balanceOf(operator)
      const balanceRecieverBefore = await token.balanceOf(toHex(receiver.toString()))
      let isSpent = await mixer.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(false)

      // Uncomment to measure gas usage
      // gas = await mixer.withdraw.estimateGas(pi_a, pi_b, pi_c, publicSignals, { from: relayer, gasPrice: '0' })
      // console.log('withdraw gas:', gas)
      const { logs } = await mixer.withdraw(pi_a, pi_b, pi_c, publicSignals, { from: relayer, gasPrice: '0' })

      const balanceMixerAfter = await token.balanceOf(mixer.address)
      const balanceRelayerAfter = await token.balanceOf(relayer)
      const balanceOperatorAfter = await token.balanceOf(operator)
      const balanceRecieverAfter = await token.balanceOf(toHex(receiver.toString()))
      const feeBN = toBN(fee.toString())
      balanceMixerAfter.should.be.eq.BN(toBN(balanceMixerBefore).sub(toBN(value)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore))
      balanceOperatorAfter.should.be.eq.BN(toBN(balanceOperatorBefore).add(feeBN))
      balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(value)).sub(feeBN))


      logs[0].event.should.be.equal('Withdraw')
      logs[0].args.nullifierHash.should.be.eq.BN(toBN(input.nullifierHash.toString()))
      logs[0].args.fee.should.be.eq.BN(feeBN)
      isSpent = await mixer.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(true)
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    // eslint-disable-next-line require-atomic-updates
    snapshotId = await takeSnapshot()
    tree = new MerkleTree(
      levels,
      zeroValue,
      null,
      prefix,
    )
  })
})
