/* global artifacts, web3, contract, assert */
require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()

const { takeSnapshot, revertSnapshot } = require('../scripts/ganacheHelper')

const MerkleTreeWithHistory = artifacts.require('./MerkleTreeWithHistoryMock.sol')
const MiMC = artifacts.require('./MiMC.sol')

const MerkleTree = require('../lib/MerkleTree')
const MimcHasher = require('../lib/MiMC')

const { AMOUNT, MERKLE_TREE_HEIGHT, EMPTY_ELEMENT } = process.env

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
  let miMC
  let levels = MERKLE_TREE_HEIGHT || 16
  let zeroValue = EMPTY_ELEMENT || 1337
  const sender = accounts[0]
  // eslint-disable-next-line no-unused-vars
  const value = AMOUNT || '1000000000000000000'
  let snapshotId
  let prefix = 'test'
  let tree
  let hasher

  before(async () => {
    tree = new MerkleTree(
      levels,
      zeroValue,
      null,
      prefix,
    )
    miMC = await MiMC.deployed()
    await MerkleTreeWithHistory.link(MiMC, miMC.address)
    merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels, zeroValue)
    snapshotId = await takeSnapshot()
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const filled_subtrees = await merkleTreeWithHistory.filled_subtrees()
      filled_subtrees[0].should.be.eq.BN(zeroValue)
      const zeros = await merkleTreeWithHistory.zeros()
      zeros[0].should.be.eq.BN(zeroValue)
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
      hasher = new MimcHasher()
      tree = new MerkleTree(
        2,
        zeroValue,
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
        zeroValue,
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
        zeroValue,
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
        zeroValue,
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
      zeroValue = 1337
      merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels, zeroValue)

      for (let i = 0; i < 2**(levels - 1); i++) {
        await merkleTreeWithHistory.insert(i+42).should.be.fulfilled
      }

      let error = await merkleTreeWithHistory.insert(1337).should.be.rejected
      error.reason.should.be.equal('Merkle tree is full')

      error = await merkleTreeWithHistory.insert(1).should.be.rejected
      error.reason.should.be.equal('Merkle tree is full')
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    // eslint-disable-next-line require-atomic-updates
    snapshotId = await takeSnapshot()
    hasher = new MimcHasher()
    tree = new MerkleTree(
      levels,
      zeroValue,
      null,
      prefix,
      null,
      hasher,
    )
  })
})
