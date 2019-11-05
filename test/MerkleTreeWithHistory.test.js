/* global artifacts, web3, contract, assert */
require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()

const { takeSnapshot, revertSnapshot } = require('../lib/ganacheHelper')

const MerkleTreeWithHistory = artifacts.require('./MerkleTreeWithHistoryMock.sol')
const hasherContract = artifacts.require('./Hasher.sol')

const MerkleTree = require('../lib/MerkleTree')
const hasherImpl = require('../lib/MiMC')

const { ETH_AMOUNT, MERKLE_TREE_HEIGHT } = process.env

// eslint-disable-next-line no-unused-vars
function BNArrayToStringArray(array) {
  const arrayToPrint = []
  array.forEach(item => {
    arrayToPrint.push(item.toString())
  })
  return arrayToPrint
}

contract('MerkleTreeWithHistory', accounts => {
  let merkleTreeWithHistory
  let hasherInstance
  let levels = MERKLE_TREE_HEIGHT || 16
  const sender = accounts[0]
  // eslint-disable-next-line no-unused-vars
  const value = ETH_AMOUNT || '1000000000000000000'
  let snapshotId
  let prefix = 'test'
  let tree
  let hasher

  before(async () => {
    tree = new MerkleTree(
      levels,
      null,
      prefix,
    )
    hasherInstance = await hasherContract.deployed()
    await MerkleTreeWithHistory.link(hasherContract, hasherInstance.address)
    merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels)
    snapshotId = await takeSnapshot()
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const zeroValue = await merkleTreeWithHistory.ZERO_VALUE()
      const firstSubtree = await merkleTreeWithHistory.filledSubtrees(0)
      firstSubtree.should.be.eq.BN(zeroValue)
      const firstZero = await merkleTreeWithHistory.zeros(0)
      firstZero.should.be.eq.BN(zeroValue)
    })
  })

  describe('merkleTreeLib', () => {
    it('index_to_key', () => {
      assert.equal(
        MerkleTree.index_to_key('test', 5, 20),
        'test_tree_5_20',
      )
    })

    it('tests insert', async () => {
      hasher = new hasherImpl()
      tree = new MerkleTree(
        2,
        null,
        prefix,
      )
      await tree.insert('5')
      let { root, path_elements } = await tree.path(0)
      const calculated_root = hasher.hash(null,
        hasher.hash(null, '5', path_elements[0]),
        path_elements[1]
      )
      // console.log(root)
      assert.equal(root, calculated_root)
    })
    it('creation odd elements count', async () => {
      const elements = [12, 13, 14, 15, 16, 17, 18, 19, 20]
      for(const [, el] of Object.entries(elements)) {
        await tree.insert(el)
      }

      const batchTree = new MerkleTree(
        levels,
        elements,
        prefix,
      )
      for(const [i] of Object.entries(elements)) {
        const pathViaConstructor = await batchTree.path(i)
        const pathViaUpdate = await tree.path(i)
        pathViaConstructor.should.be.deep.equal(pathViaUpdate)
      }
    })

    it('should find an element', async () => {
      const elements = [12, 13, 14, 15, 16, 17, 18, 19, 20]
      for(const [, el] of Object.entries(elements)) {
        await tree.insert(el)
      }
      let index = tree.getIndexByElement(13)
      index.should.be.equal(1)

      index = tree.getIndexByElement(19)
      index.should.be.equal(7)

      index = tree.getIndexByElement(12)
      index.should.be.equal(0)

      index = tree.getIndexByElement(20)
      index.should.be.equal(8)

      index = tree.getIndexByElement(42)
      index.should.be.equal(false)
    })

    it('creation even elements count', async () => {
      const elements = [12, 13, 14, 15, 16, 17]
      for(const [, el] of Object.entries(elements)) {
        await tree.insert(el)
      }

      const batchTree = new MerkleTree(
        levels,
        elements,
        prefix,
      )
      for(const [i] of Object.entries(elements)) {
        const pathViaConstructor = await batchTree.path(i)
        const pathViaUpdate = await tree.path(i)
        pathViaConstructor.should.be.deep.equal(pathViaUpdate)
      }
    })

    it.skip('creation using 30000 elements', () => {
      const elements = []
      for(let i = 1000; i < 31001; i++) {
        elements.push(i)
      }
      console.time('MerkleTree')
      tree = new MerkleTree(
        levels,
        elements,
        prefix,
      )
      console.timeEnd('MerkleTree')
      // 2,7 GHz Intel Core i7
      // 1000 : 1949.084ms
      // 10000: 19456.220ms
      // 30000: 63406.679ms
    })
  })

  describe('#insert', () => {
    it('should insert', async () => {
      let rootFromContract

      for (let i = 1; i < 11; i++) {
        await merkleTreeWithHistory.insert(i, { from: sender })
        await tree.insert(i)
        let { root } = await tree.path(i - 1)
        rootFromContract = await merkleTreeWithHistory.getLastRoot()
        root.should.be.equal(rootFromContract.toString())
      }
    })

    it('should reject if tree is full', async () => {
      levels = 6
      merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels)

      for (let i = 0; i < 2**levels; i++) {
        await merkleTreeWithHistory.insert(i+42).should.be.fulfilled
      }

      let error = await merkleTreeWithHistory.insert(1337).should.be.rejected
      error.reason.should.be.equal('Merkle tree is full. No more leafs can be added')

      error = await merkleTreeWithHistory.insert(1).should.be.rejected
      error.reason.should.be.equal('Merkle tree is full. No more leafs can be added')
    })

    it.skip('hasher gas', async () => {
      levels = 6
      merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels)
      const zeroValue = await merkleTreeWithHistory.zeroValue()

      const gas = await merkleTreeWithHistory.hashLeftRight.estimateGas(zeroValue, zeroValue)
      console.log('gas', gas - 21000)
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    // eslint-disable-next-line require-atomic-updates
    snapshotId = await takeSnapshot()
    hasher = new hasherImpl()
    tree = new MerkleTree(
      levels,
      null,
      prefix,
      null,
      hasher,
    )
  })
})
