const should = require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
.should()

const { toWei, toBN } = require('web3-utils')
const { takeSnapshot, revertSnapshot, increaseTime } = require('../scripts/ganacheHelper');

const MerkleTreeWithHistory = artifacts.require('./MerkleTreeWithHistoryMock.sol')
const MiMC = artifacts.require('./MiMC.sol')

const JsStorage = require('../lib/Storage')
const MerkleTree = require('../lib/MerkleTree')
const MimcHacher = require('../lib/MiMC')

function BNArrayToStringArray(array) {
  const arrayToPrint = []
  array.forEach(item => {
    arrayToPrint.push(item.toString())
  })
  return arrayToPrint
}

contract('MerkleTreeWithHistory', async accounts => {
  let merkleTreeWithHistory
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
    miMC = await MiMC.deployed()
    await MerkleTreeWithHistory.link(MiMC, miMC.address)
    merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels, zeroValue)
    snapshotId = await takeSnapshot()
  })

  describe('#constructor', async () => {
    it('should initialize', async () => {
      const filled_subtrees = await merkleTreeWithHistory.filled_subtrees()
      // console.log('filled_subtrees', BNArrayToStringArray(filled_subtrees))
      const root = await merkleTreeWithHistory.getLastRoot()
      // console.log('root', root.toString())
      filled_subtrees[0].should.be.eq.BN(zeroValue)
      const zeros = await merkleTreeWithHistory.zeros()
      // console.log('zeros', BNArrayToStringArray(zeros))
      zeros[0].should.be.eq.BN(zeroValue)
      const roots = await merkleTreeWithHistory.roots()
      // console.log('roots', BNArrayToStringArray(roots))
    })
  })

  describe('merkleTreeLib', async () => {
    it('index_to_key', async () => {
      assert.equal(
        MerkleTree.index_to_key('test', 5, 20),
        "test_tree_5_20",
      )
    })

    it('tests insert', async () => {
      const storage = new JsStorage()
      hasher = new MimcHacher()
      tree = new MerkleTree(
        prefix,
        storage,
        hasher,
        2,
        zeroValue,
      )
      await tree.insert('5')
      let {root, path_elements, path_index} = await tree.path(0)
      const calculated_root = hasher.hash(null,
        hasher.hash(null, '5', path_elements[0]),
        path_elements[1]
      )
      // console.log(root)
      assert.equal(root, calculated_root)
    })
    it('creation odd elements count', async () => {
      const elements = [12, 13, 14, 15, 16, 17, 18, 19, 20]
      for(const [i, el] of Object.entries(elements)) {
        await tree.insert(el)
      }

      const storage = new JsStorage()
      hasher = new MimcHacher()
      const batchTree = new MerkleTree(
        prefix,
        storage,
        hasher,
        levels,
        zeroValue,
        elements
      );
      for(const [i, el] of Object.entries(elements)) {
        const pathViaConstructor = await batchTree.path(i)
        const pathViaUpdate = await tree.path(i)
        pathViaConstructor.should.be.deep.equal(pathViaUpdate)
      }
    })

    it('creation even elements count', async () => {
      const elements = [12, 13, 14, 15, 16, 17]
      for(const [i, el] of Object.entries(elements)) {
        await tree.insert(el)
      }

      const storage = new JsStorage()
      hasher = new MimcHacher()
      const batchTree = new MerkleTree(
        prefix,
        storage,
        hasher,
        levels,
        zeroValue,
        elements
      );
      for(const [i, el] of Object.entries(elements)) {
        const pathViaConstructor = await batchTree.path(i)
        const pathViaUpdate = await tree.path(i)
        pathViaConstructor.should.be.deep.equal(pathViaUpdate)
      }
    })

    it.skip('creation using 30000 elements', async () => {
      const elements = []
      for(let i = 1000; i < 31001; i++) {
        elements.push(i)
      }
      const storage = new JsStorage()
      hasher = new MimcHacher()
      console.time('MerkleTree');
      tree = new MerkleTree(
        prefix,
        storage,
        hasher,
        levels,
        zeroValue,
        elements
      );
      console.timeEnd('MerkleTree');
      // 2,7 GHz Intel Core i7
      // 1000 : 1949.084ms
      // 10000: 19456.220ms
      // 30000: 63406.679ms
    })
  })

  describe('#insert', async () => {
    it('should insert', async () => {
      let filled_subtrees
      let rootFromContract

      for (i = 1; i < 11; i++) {
        await merkleTreeWithHistory.insert(i)
        await tree.insert(i)
        filled_subtrees = await merkleTreeWithHistory.filled_subtrees()
        let {root, path_elements, path_index} = await tree.path(i - 1)
        // console.log('path_elements  ', path_elements)
        // console.log('filled_subtrees', BNArrayToStringArray(filled_subtrees))
        // console.log('rootFromLib', root)
        rootFromContract = await merkleTreeWithHistory.getLastRoot()
        root.should.be.equal(rootFromContract.toString())
        // console.log('rootFromCon', root.toString())
      }
    })
  })

  describe('#MIMC', async () => {
    it.skip('gas price', async () => {
      const gas = await merkleTreeWithHistory.hashLeftRight.estimateGas(1,2)
      console.log('gas', gas)
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    snapshotId = await takeSnapshot()
    const storage = new JsStorage()
    hasher = new MimcHacher()
    tree = new MerkleTree(
      prefix,
      storage,
      hasher,
      levels,
      zeroValue,
    )
  })
})
