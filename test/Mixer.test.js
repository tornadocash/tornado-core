const should = require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
.should()

const { toWei, toBN, fromWei, toHex, randomHex } = require('web3-utils')
const { takeSnapshot, revertSnapshot, increaseTime } = require('../scripts/ganacheHelper');

const Mixer = artifacts.require('./Mixer.sol')
const { AMOUNT } = process.env

const utils = require('../scripts/utils')
const stringifyBigInts = require('websnark/tools/stringifybigint').stringifyBigInts
const snarkjs = require('snarkjs');
const bigInt = snarkjs.bigInt;
const MerkleTree = require('../lib/MerkleTree')

function generateDeposit() {
  let deposit = {
    secret: utils.rbigint(31),
    nullifier: utils.rbigint(31),
  };
  const preimage = Buffer.concat([deposit.nullifier.leInt2Buff(32), deposit.secret.leInt2Buff(32)]);
  deposit.commitment = utils.pedersenHash(preimage);
  return deposit;
}

function BNArrayToStringArray(array) {
  const arrayToPrint = []
  array.forEach(item => {
    arrayToPrint.push(item.toString())
  })
  return arrayToPrint
}

contract('Mixer', async accounts => {
  let mixer
  const sender = accounts[0]
  const emptyAddress = '0x0000000000000000000000000000000000000000'
  const levels = 16
  const zeroValue = 1337
  let snapshotId
  let prefix = 'test'
  let tree
  const fee = bigInt(1e17)
  const receiver = utils.rbigint(20)
  const relayer = accounts[1]

  before(async () => {
    tree = new MerkleTree(
      levels,
      zeroValue,
      null,
      prefix,
    )
    mixer = await Mixer.deployed()
    snapshotId = await takeSnapshot()
  })

  describe('#constructor', async () => {
    it('should initialize', async () => {
      const transferValue = await mixer.transferValue()
      transferValue.should.be.eq.BN(toBN(AMOUNT))
    })
  })

  describe('#deposit', async () => {
    it('should emit event', async () => {
      const commitment = 42
      const { logs } = await mixer.deposit(commitment, { value: AMOUNT, from: sender })
      logs[0].event.should.be.equal('LeafAdded')
      logs[0].args.leaf.should.be.eq.BN(toBN(commitment))
      logs[0].args.leaf_index.should.be.eq.BN(toBN(0))

      logs[1].event.should.be.equal('Deposit')
      logs[1].args.from.should.be.equal(sender)
      logs[1].args.commitment.should.be.eq.BN(toBN(commitment))
    })

    it('should throw if there is a such commitment', async () => {
      const commitment = 42
      await mixer.deposit(commitment, { value: AMOUNT, from: sender }).should.be.fulfilled
      const error = await mixer.deposit(commitment, { value: AMOUNT, from: sender }).should.be.rejected
      error.reason.should.be.equal('The commitment has been submitted')
    })
  })

  describe('#withdraw', async () => {
    it('should work', async () => {
      const deposit = generateDeposit()
      const user = accounts[4]
      await tree.insert(deposit.commitment)

      const balanceUserBefore = await web3.eth.getBalance(user)

      await mixer.deposit(toBN(deposit.commitment.toString()), { value: AMOUNT, from: user, gasPrice: '0' })

      const balanceUserAfter = await web3.eth.getBalance(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(AMOUNT)))

      const {root, path_elements, path_index} = await tree.path(0);

      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifier: deposit.nullifier,
        receiver,
        fee,

        // private
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndex: path_index,
      })

      const { pi_a, pi_b, pi_c, publicSignals } = await utils.snarkProof(input)

      const balanceMixerBefore = await web3.eth.getBalance(mixer.address)
      const balanceRelayerBefore = await web3.eth.getBalance(relayer)
      const balanceRecieverBefore = await web3.eth.getBalance(toHex(receiver.toString()))

      const { logs } = await mixer.withdraw(pi_a, pi_b, pi_c, publicSignals, { from: relayer, gasPrice: '0' })

      const balanceMixerAfter = await web3.eth.getBalance(mixer.address)
      const balanceRelayerAfter = await web3.eth.getBalance(relayer)
      const balanceRecieverAfter = await web3.eth.getBalance(toHex(receiver.toString()))
      const feeBN = toBN(fee.toString())
      balanceMixerAfter.should.be.eq.BN(toBN(balanceMixerBefore).sub(toBN(AMOUNT)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).add(feeBN))
      balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(AMOUNT)).sub(feeBN))

      logs[0].event.should.be.equal('Withdraw')
      logs[0].args.nullifier.should.be.eq.BN(toBN(deposit.nullifier.toString()))
      logs[0].args.fee.should.be.eq.BN(feeBN)
    })

    it('should prevent double spend', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await mixer.deposit(toBN(deposit.commitment.toString()), { value: AMOUNT, from: sender })

      const {root, path_elements, path_index} = await tree.path(0);

      const input = stringifyBigInts({
        root,
        nullifier: deposit.nullifier,
        receiver,
        fee,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndex: path_index,
      })

      const { pi_a, pi_b, pi_c, publicSignals } = await utils.snarkProof(input)
      await mixer.withdraw(pi_a, pi_b, pi_c, publicSignals, { from: relayer }).should.be.fulfilled
      const error = await mixer.withdraw(pi_a, pi_b, pi_c, publicSignals, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('The note has been already spent')
    })

    it('fee should be less or equal transfer value', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await mixer.deposit(toBN(deposit.commitment.toString()), { value: AMOUNT, from: sender })

      const {root, path_elements, path_index} = await tree.path(0);
      oneEtherFee = bigInt(1e18) // 1 ether
      const input = stringifyBigInts({
        root,
        nullifier: deposit.nullifier,
        receiver,
        fee: oneEtherFee,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndex: path_index,
      })

      const { pi_a, pi_b, pi_c, publicSignals } = await utils.snarkProof(input)
      const error = await mixer.withdraw(pi_a, pi_b, pi_c, publicSignals, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('Fee exceeds transfer value')
    })

    it('should throw for corrupted merkle tree root', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await mixer.deposit(toBN(deposit.commitment.toString()), { value: AMOUNT, from: sender })

      const {root, path_elements, path_index} = await tree.path(0)

      const input = stringifyBigInts({
        root,
        nullifier: deposit.nullifier,
        receiver,
        fee,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndex: path_index,
      })

      const dummyRoot = randomHex(32)
      const { pi_a, pi_b, pi_c, publicSignals } = await utils.snarkProof(input)
      publicSignals[0] = dummyRoot

      const error = await mixer.withdraw(pi_a, pi_b, pi_c, publicSignals, { from: relayer }).should.be.rejected
      error.reason.should.be.equal('Cannot find your merkle root')
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    snapshotId = await takeSnapshot()
    tree = new MerkleTree(
      levels,
      zeroValue,
      null,
      prefix,
    )
  })
})
