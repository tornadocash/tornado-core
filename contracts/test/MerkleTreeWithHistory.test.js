const should = require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
.should()

const { toWei, toBN } = require('web3-utils')
const { takeSnapshot, revertSnapshot, increaseTime } = require('../scripts/ganacheHelper');

const MerkleTreeWithHistory = artifacts.require('./MerkleTreeWithHistoryMock.sol')
const MiMC = artifacts.require('./MiMC.sol')

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
  const levels = 5
  const zeroValue = 1337
  let snapshotId

  before(async () => {
    miMC = MiMC.deployed()
    await MerkleTreeWithHistory.link(MiMC, miMC.address);
    merkleTreeWithHistory = await MerkleTreeWithHistory.new(levels, zeroValue)
    snapshotId = await takeSnapshot()
  })

  describe('#constuctor', async () => {
    it('should initialize', async () => {
      const filled_subtrees = await merkleTreeWithHistory.filled_subtrees()
      console.log('filled_subtrees', BNArrayToStringArray(filled_subtrees))
      const root = await merkleTreeWithHistory.getLastRoot()
      console.log('root', root.toString())
      filled_subtrees[0].should.be.eq.BN(zeroValue)
      const zeros = await merkleTreeWithHistory.zeros()
      // console.log('zeros', BNArrayToStringArray(zeros))
      zeros[0].should.be.eq.BN(zeroValue)
      const roots = await merkleTreeWithHistory.roots()
      // console.log('roots', BNArrayToStringArray(roots))
    })
  })

  describe('#insert', async () => {
    it('should insert', async () => {
      let filled_subtrees
      let root

      for (i = 1; i < 11; i++) {
        await merkleTreeWithHistory.insert(i)
        filled_subtrees = await merkleTreeWithHistory.filled_subtrees()
        console.log('filled_subtrees', BNArrayToStringArray(filled_subtrees))
        root = await merkleTreeWithHistory.getLastRoot()
        console.log('root', root.toString())
      }

    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    snapshotId = await takeSnapshot()
  })
})
