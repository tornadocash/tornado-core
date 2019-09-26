/* global artifacts, web3, contract */
require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()
const fs = require('fs')
const Web3 = require('web3')

const { toBN, toHex, toChecksumAddress } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('../lib/ganacheHelper')
const { deployRelayHub, fundRecipient } = require('@openzeppelin/gsn-helpers')
const { GSNDevProvider } = require('@openzeppelin/gsn-provider')
const { ephemeral } = require('@openzeppelin/network')

const Mixer = artifacts.require('./ETHMixer.sol')
const { ETH_AMOUNT, MERKLE_TREE_HEIGHT, EMPTY_ELEMENT } = process.env

const websnarkUtils = require('websnark/src/utils')
const buildGroth16 = require('websnark/src/groth16')
const stringifyBigInts = require('websnark/tools/stringifybigint').stringifyBigInts
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

function getRandomReceiver() {
  let receiver = rbigint(20)
  while (toHex(receiver.toString()).length !== 42) {
    receiver = rbigint(20)
  }
  return receiver
}

contract('GSN support', accounts => {
  let mixer
  let gsnMixer
  let relayHubAddress
  const sender = accounts[0]
  const operator = accounts[0]
  const ownerAddress = accounts[8]
  const relayerAddress = accounts[9]
  const levels = MERKLE_TREE_HEIGHT || 16
  const zeroValue = EMPTY_ELEMENT || 1337
  const value = ETH_AMOUNT || '1000000000000000000' // 1 ether
  let snapshotId
  let prefix = 'test'
  let tree
  const fee = bigInt(ETH_AMOUNT).shr(1) || bigInt(1e17)
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
    relayHubAddress = toChecksumAddress(await deployRelayHub(web3, {
      from: sender
    }))
    await fundRecipient(web3, { recipient: mixer.address, relayHubAddress })
    await mixer.upgradeRelayHub(relayHubAddress)
    snapshotId = await takeSnapshot()
    groth16 = await buildGroth16()
    circuit = require('../build/circuits/withdraw.json')
    proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const hub = await mixer.getHubAddr()
      hub.should.be.equal(relayHubAddress)
    })
  })

  describe('#withdrawViaRelayer', () => {
    it.only('should work', async () => {
      const gasPrice = toBN('20000000000')
      const relayerTxFee = 10 // 20%
      const deposit = generateDeposit()
      const user = accounts[4]
      await tree.insert(deposit.commitment)

      const balanceUserBefore = await web3.eth.getBalance(user)

      // Uncomment to measure gas usage
      // let gas = await mixer.deposit.estimateGas(toBN(deposit.commitment.toString()), { value, from: user, gasPrice: '0' })
      // console.log('deposit gas:', gas)
      const txDeposit = await mixer.deposit(toBN(deposit.commitment.toString()), { value, from: user, gasPrice })
      // console.log('txDeposit', txDeposit.receipt)
      const txFee = toBN(txDeposit.receipt.gasUsed).mul(gasPrice)
      // console.log('txFee', txFee.toString())
      const balanceUserAfter = await web3.eth.getBalance(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(value).add(txFee)))

      const { root, path_elements, path_index } = await tree.path(0)

      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        receiver,
        relayer: operator, // this value wont be taken into account
        fee: bigInt(1),    // this value wont be taken into account

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndex: path_index,
      })


      const proof = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { pi_a, pi_b, pi_c, publicSignals } = websnarkUtils.toSolidityInput(proof)

      const balanceMixerBefore = await web3.eth.getBalance(mixer.address)
      const balanceHubBefore = await web3.eth.getBalance(relayHubAddress)
      const balanceRelayerBefore = await web3.eth.getBalance(relayerAddress)
      const balanceRelayerOwnerBefore = await web3.eth.getBalance(ownerAddress)
      const balanceRecieverBefore = await web3.eth.getBalance(toHex(receiver.toString()))
      let isSpent = await mixer.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(false)

      const account = ephemeral()
      const provider = new GSNDevProvider('http://localhost:8545', {
        signKey: account,
        ownerAddress,
        relayerAddress,
        verbose: true,
        txFee: relayerTxFee
      })
      // console.log('relayerAddress', relayerAddress)
      const gsnWeb3 = new Web3(provider, null, { transactionConfirmationBlocks: 1 })
      gsnMixer = new gsnWeb3.eth.Contract(mixer.abi, mixer.address)
      const tx = await gsnMixer.methods.withdrawViaRelayer(pi_a, pi_b, pi_c, publicSignals).send({
        from: account.address,
        gas: 3e6,
        gasPrice,
        value: 0
      })
      // console.log('tx', tx)
      const { events, gasUsed } = tx
      // console.log('events', events, gasUsed)
      const balanceMixerAfter = await web3.eth.getBalance(mixer.address)
      const balanceHubAfter = await web3.eth.getBalance(relayHubAddress)
      const balanceRelayerAfter = await web3.eth.getBalance(relayerAddress)
      const balanceRelayerOwnerAfter = await web3.eth.getBalance(ownerAddress)
      const balanceRecieverAfter = await web3.eth.getBalance(toHex(receiver.toString()))
      console.log('balanceMixerBefore, balanceMixerAfter', balanceMixerBefore.toString(), balanceMixerAfter.toString())
      console.log('balanceRecieverBefore, balanceRecieverAfter', balanceRecieverBefore.toString(), balanceRecieverAfter.toString())
      console.log('balanceHubBefore, balanceHubAfter', balanceHubBefore.toString(), balanceHubAfter.toString())
      console.log('balanceRelayerBefore, balanceRelayerAfter', balanceRelayerBefore.toString(), balanceRelayerAfter.toString(), toBN(balanceRelayerBefore).sub(toBN(balanceRelayerAfter)).toString())
      console.log('balanceRelayerOwnerBefore, balanceRelayerOwnerAfter', balanceRelayerOwnerBefore.toString(), balanceRelayerOwnerAfter.toString())
      // balanceMixerAfter.should.be.eq.BN(toBN(balanceMixerBefore).sub(toBN(value)))
      const networkFee = toBN(gasUsed).mul(gasPrice)
      const chargedFee = networkFee.add(networkFee.div(toBN(relayerTxFee)))
      console.log('networkFee, calc chargedFee', networkFee.toString(), chargedFee.toString())
      // const fee = toBN(value).sub(toBN(balanceRecieverAfter))
      // console.log('actual charged fee', fee.toString())
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).sub(networkFee))
      // balanceRelayerOwnerAfter.should.be.eq.BN(toBN(balanceRelayerOwnerBefore))
      // balanceRecieverAfter.should.be.gt.BN(toBN(balanceRecieverBefore))
      // balanceHubAfter.should.be.eq.BN(toBN(balanceHubBefore).add(fee))

      // console.log('events.Withdraw.returnValues.nullifierHash', events.Withdraw.returnValues.nullifierHash.toString(), input.nullifierHash.toString())
      // events.Withdraw.returnValues.nullifierHash.should.be.eq.BN(toBN(input.nullifierHash.toString()))
      events.Withdraw.returnValues.relayer.should.be.eq.BN(relayerAddress)
      events.Withdraw.returnValues.to.should.be.eq.BN(toHex(receiver.toString()))

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
