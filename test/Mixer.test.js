const should = require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
.should()

const { toWei, toBN, fromWei } = require('web3-utils')
const { takeSnapshot, revertSnapshot, increaseTime } = require('../scripts/ganacheHelper');

const Mixer = artifacts.require('./Mixer.sol')
const { AMOUNT } = process.env

const utils = require("../scripts/utils")
const stringifyBigInts = require("websnark/tools/stringifybigint").stringifyBigInts
const snarkjs = require("snarkjs");
const bigInt = snarkjs.bigInt;
const JsStorage = require('../lib/Storage')
const MerkleTree = require('../lib/MerkleTree')
const MimcHacher = require('../lib/MiMC')

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
  let miMC
  const sender = accounts[0]
  const emptyAddress = '0x0000000000000000000000000000000000000000'
  const levels = 16
  const zeroValue = 1337
  let snapshotId
  let prefix = 'test'
  let tree
  let hasher

  before(async () => {
    const storage = new JsStorage()
    hasher = new MimcHacher()
    tree = new MerkleTree(
      prefix,
      storage,
      hasher,
      levels,
      zeroValue,
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
    it.skip('should work', async () => {
      const deposit = generateDeposit()
      await tree.insert(deposit.commitment)
      await mixer.deposit(toBN(deposit.commitment.toString()), { value: AMOUNT, from: sender })

      const {root, path_elements, path_index} = await tree.path(0);

      // Circuit input
      const input = stringifyBigInts({
        // public
        root: root,
        nullifier: deposit.nullifier,
        receiver: utils.rbigint(20),
        fee: bigInt(1e17),

        // private
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndex: path_index,
      })

      const { pi_a, pi_b, pi_c, publicSignals } = await utils.snarkProof(input)
      console.log('proof', pi_a, pi_b, pi_c, publicSignals)
      const { logs } = await mixer.withdraw(pi_a, pi_b, pi_c, publicSignals, { from: sender })
      console.log('logs', logs)
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    snapshotId = await takeSnapshot()
  })
})
