const should = require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
.should()

const { toWei, toBN, fromWei } = require('web3-utils')
const { takeSnapshot, revertSnapshot, increaseTime } = require('../scripts/ganacheHelper');

const Mixer = artifacts.require('./Mixer.sol')


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
    mixer = await Mixer.deployed()
    snapshotId = await takeSnapshot()
  })

  describe('#constructor', async () => {
    it('should initialize', async () => {
      const { AMOUNT } = process.env
      const transferValue = await mixer.transferValue()
      transferValue.should.be.eq.BN(toBN(AMOUNT))
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    snapshotId = await takeSnapshot()
  })
})
