const should = require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
.should()

const { toWei, toBN, fromWei, toHex } = require('web3-utils')
const { takeSnapshot, revertSnapshot, increaseTime } = require('../scripts/ganacheHelper');

const Mixer = artifacts.require('./Mixer.sol')
const { AMOUNT } = process.env

const utils = require("../scripts/utils")
const stringifyBigInts = require("websnark/tools/stringifybigint").stringifyBigInts
const snarkjs = require("snarkjs");
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

contract('Mixer', async accounts => {
  let mixer
  const sender = accounts[0]
  const emptyAddress = '0x0000000000000000000000000000000000000000'
  const levels = 16
  const zeroValue = 1337
  let snapshotId
  let prefix = 'test'
  let tree

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
  })

  describe('#withdraw', async () => {
    it('should work', async () => {
      const receiver = utils.rbigint(20)
      let fee = bigInt(1e17)
      const deposit = generateDeposit()
      const relayer = sender
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
      fee = toBN(fee.toString())
      balanceMixerAfter.should.be.eq.BN(toBN(balanceMixerBefore).sub(toBN(AMOUNT)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).add(fee))
      balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(AMOUNT)).sub(fee))

      logs[0].event.should.be.equal('Withdraw')
      logs[0].args.nullifier.should.be.eq.BN(toBN(deposit.nullifier.toString()))
      logs[0].args.fee.should.be.eq.BN(fee)
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    snapshotId = await takeSnapshot()
  })
})
