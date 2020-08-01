/* global artifacts, web3, contract */
require('chai').use(require('bn-chai')(web3.utils.BN)).use(require('chai-as-promised')).should()

const { takeSnapshot, revertSnapshot } = require('../scripts/ganacheHelper')

const MerkleTreeWithHistory = artifacts.require('./MerkleTreeWithHistoryMock.sol')
const hasherContract = artifacts.require('./Hasher.sol')

const MerkleTree = require('fixed-merkle-tree')

const snarkjs = require('snarkjs')
const bigInt = snarkjs.bigInt

const { ETH_AMOUNT, MERKLE_TREE_HEIGHT } = process.env

// eslint-disable-next-line no-unused-vars
function BNArrayToStringArray(array) {
  const arrayToPrint = []
  array.forEach((item) => {
    arrayToPrint.push(item.toString())
  })
  return arrayToPrint
}

function toFixedHex(number, length = 32) {
  let str = bigInt(number).toString(16)
  while (str.length < length * 2) str = '0' + str
  str = '0x' + str
  return str
}

contract('MerkleTreeWithHistory', (accounts) => {
  let merkleTreeWithHistory
  let hasherInstance
  let levels = MERKLE_TREE_HEIGHT || 16
  const sender = accounts[0]
  // eslint-disable-next-line no-unused-vars
  const value = ETH_AMOUNT || '1000000000000000000'
  let snapshotId
  let tree

  before(async () => {
    tree = new MerkleTree(levels)
    hasherInstance = await hasherContract.deployed()
    merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels, hasherInstance.address)
    snapshotId = await takeSnapshot()
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const zeroValue = await merkleTreeWithHistory.ZERO_VALUE()
      const firstSubtree = await merkleTreeWithHistory.filledSubtrees(0)
      firstSubtree.should.be.equal(toFixedHex(zeroValue))
      const firstZero = await merkleTreeWithHistory.zeros(0)
      firstZero.should.be.equal(toFixedHex(zeroValue))
    })
  })

  describe('#insert', () => {
    it('should insert', async () => {
      let rootFromContract

      for (let i = 1; i < 11; i++) {
        await merkleTreeWithHistory.insert(toFixedHex(i), { from: sender })
        tree.insert(i)
        rootFromContract = await merkleTreeWithHistory.getLastRoot()
        toFixedHex(tree.root()).should.be.equal(rootFromContract.toString())
      }
    })

    it('should reject if tree is full', async () => {
      const levels = 6
      const merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels, hasherInstance.address)

      for (let i = 0; i < 2 ** levels; i++) {
        await merkleTreeWithHistory.insert(toFixedHex(i + 42)).should.be.fulfilled
      }

      let error = await merkleTreeWithHistory.insert(toFixedHex(1337)).should.be.rejected
      error.reason.should.be.equal('Merkle tree is full. No more leaves can be added')

      error = await merkleTreeWithHistory.insert(toFixedHex(1)).should.be.rejected
      error.reason.should.be.equal('Merkle tree is full. No more leaves can be added')
    })

    it.skip('hasher gas', async () => {
      const levels = 6
      const merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels)
      const zeroValue = await merkleTreeWithHistory.zeroValue()

      const gas = await merkleTreeWithHistory.hashLeftRight.estimateGas(zeroValue, zeroValue)
      console.log('gas', gas - 21000)
    })
  })

  describe('#isKnownRoot', () => {
    it('should work', async () => {
      for (let i = 1; i < 5; i++) {
        await merkleTreeWithHistory.insert(toFixedHex(i), { from: sender }).should.be.fulfilled
        await tree.insert(i)
        let isKnown = await merkleTreeWithHistory.isKnownRoot(toFixedHex(tree.root()))
        isKnown.should.be.equal(true)
      }

      await merkleTreeWithHistory.insert(toFixedHex(42), { from: sender }).should.be.fulfilled
      // check outdated root
      let isKnown = await merkleTreeWithHistory.isKnownRoot(toFixedHex(tree.root()))
      isKnown.should.be.equal(true)
    })

    it('should not return uninitialized roots', async () => {
      await merkleTreeWithHistory.insert(toFixedHex(42), { from: sender }).should.be.fulfilled
      let isKnown = await merkleTreeWithHistory.isKnownRoot(toFixedHex(0))
      isKnown.should.be.equal(false)
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    // eslint-disable-next-line require-atomic-updates
    snapshotId = await takeSnapshot()
    tree = new MerkleTree(levels)
  })
})
