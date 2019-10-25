/* global artifacts, web3, contract */
require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()
const fs = require('fs')
const Web3 = require('web3')

const { toBN, toHex, toChecksumAddress, toWei, fromWei } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('../lib/ganacheHelper')
const { deployRelayHub, fundRecipient } = require('@openzeppelin/gsn-helpers')
const { GSNDevProvider, GSNProvider, utils } = require('@openzeppelin/gsn-provider')
const { ephemeral } = require('@openzeppelin/network')

const Mixer = artifacts.require('./ETHMixer.sol')
const ERC20Mixer = artifacts.require('./ERC20Mixer.sol')
const RelayHub = artifacts.require('./IRelayHub.sol')
const Token = artifacts.require('./ERC20Mock.sol')
const Uniswap = artifacts.require('./UniswapMock.sol')
const { ETH_AMOUNT, MERKLE_TREE_HEIGHT, EMPTY_ELEMENT, ERC20_TOKEN, TOKEN_AMOUNT } = process.env

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
  let ercMixer
  let gsnMixer
  let hubInstance
  let relayHubAddress
  let token
  let uniswap
  const sender = accounts[0]
  const operator = accounts[0]
  const user = accounts[3]
  const relayerOwnerAddress = accounts[8]
  const relayerAddress =  accounts[9]// '0x714992E1acbc7f888Be2A1784F0D23e73f4A1ead'
  const levels = MERKLE_TREE_HEIGHT || 16
  const zeroValue = EMPTY_ELEMENT || 1337
  const value = ETH_AMOUNT || '1000000000000000000' // 1 ether
  let tokenDenomination = TOKEN_AMOUNT || '1000000000000000000' // 1 ether
  let snapshotId
  let prefix = 'test'
  let tree
  const receiver = getRandomReceiver()
  let groth16
  let circuit
  let proving_key
  let unstakeDelay = 604800
  let relayerTxFee = 20 // %
  let signKey = ephemeral()
  let gsnWeb3
  let gsnProvider
  const postRelayedCallMaxGas = 100000
  const recipientCallsAtomicOverhead = 5000
  let postRelayMaxGas = toBN(postRelayedCallMaxGas + recipientCallsAtomicOverhead)
  // this price is for tokenToEthSwapInput stategy
  // const eth2daiPriceInput = toBN(toWei('1')).mul(toBN(10e18)).div(toBN('174552286079977583324')) // cause 1 ETH == 174.55 DAI
  // this price is for tokenToEthSwapOutput stategy
  const eth2daiPrice = toBN('174552286079977583324') // cause 1 ETH == 174.55 DAI

  before(async () => {
    tree = new MerkleTree(
      levels,
      zeroValue,
      null,
      prefix,
    )
    mixer = await Mixer.deployed()
    ercMixer = await ERC20Mixer.deployed()
    relayHubAddress = toChecksumAddress(await deployRelayHub(web3, {
      from: sender
    }))

    await fundRecipient(web3, { recipient: mixer.address, relayHubAddress })
    await fundRecipient(web3, { recipient: ercMixer.address, relayHubAddress })
    const currentHub = await mixer.getHubAddr()
    await ercMixer.upgradeRelayHub(relayHubAddress)
    if (relayHubAddress !== currentHub) {
      await mixer.upgradeRelayHub(relayHubAddress)
    }
    hubInstance = await RelayHub.at(relayHubAddress)
    await hubInstance.stake(relayerAddress, unstakeDelay , { from: relayerOwnerAddress, value: toWei('1') })
    await hubInstance.registerRelay(relayerTxFee, 'http://gsn-dev-relayer.openzeppelin.com/', { from: relayerAddress })

    if (ERC20_TOKEN) {
      token = await Token.at(ERC20_TOKEN)
      // uniswap = await Uniswap.at()
    } else {
      token = await Token.deployed()
      await token.mint(user, tokenDenomination)
      uniswap = await Uniswap.deployed()
    }

    snapshotId = await takeSnapshot()
    groth16 = await buildGroth16()
    circuit = require('../build/circuits/withdraw.json')
    proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
    gsnProvider = new GSNDevProvider('http://localhost:8545', {
      signKey,
      relayerOwner: relayerOwnerAddress,
      relayerAddress,
      verbose: true,
      txFee: relayerTxFee
    })
    gsnWeb3 = new Web3(gsnProvider, null, { transactionConfirmationBlocks: 1 })
    gsnMixer = new gsnWeb3.eth.Contract(mixer.abi, mixer.address)
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const hub = await mixer.getHubAddr()
      hub.should.be.equal(relayHubAddress)
    })
  })

  describe('#withdrawViaRelayer', () => {
    it('should work', async () => {
      const gasPrice = toBN('20000000000')
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
      const balanceRelayerOwnerBefore = await web3.eth.getBalance(relayerOwnerAddress)
      const balanceRecieverBefore = await web3.eth.getBalance(toHex(receiver.toString()))
      let isSpent = await mixer.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(false)

      const tx = await gsnMixer.methods.withdrawViaRelayer(pi_a, pi_b, pi_c, publicSignals).send({
        from: signKey.address,
        gas: 3e6,
        gasPrice,
        value: 0
      })
      const { events, gasUsed } = tx
      const balanceMixerAfter = await web3.eth.getBalance(mixer.address)
      const balanceHubAfter = await web3.eth.getBalance(relayHubAddress)
      const balanceRelayerAfter = await web3.eth.getBalance(relayerAddress)
      const balanceRelayerOwnerAfter = await web3.eth.getBalance(relayerOwnerAddress)
      const balanceRecieverAfter = await web3.eth.getBalance(toHex(receiver.toString()))
      // console.log('balanceMixerBefore, balanceMixerAfter', balanceMixerBefore.toString(), balanceMixerAfter.toString())
      // console.log('balanceRecieverBefore, balanceRecieverAfter', balanceRecieverBefore.toString(), balanceRecieverAfter.toString())
      // console.log('balanceHubBefore, balanceHubAfter', balanceHubBefore.toString(), balanceHubAfter.toString())
      // console.log('balanceRelayerBefore, balanceRelayerAfter', balanceRelayerBefore.toString(), balanceRelayerAfter.toString(), toBN(balanceRelayerBefore).sub(toBN(balanceRelayerAfter)).toString())
      // console.log('balanceRelayerOwnerBefore, balanceRelayerOwnerAfter', balanceRelayerOwnerBefore.toString(), balanceRelayerOwnerAfter.toString())
      balanceMixerAfter.should.be.eq.BN(toBN(balanceMixerBefore).sub(toBN(value)))
      const networkFee = toBN(gasUsed).mul(gasPrice)
      const chargedFee = networkFee.add(networkFee.div(toBN(relayerTxFee)))
      // console.log('networkFee                 :', networkFee.toString())
      // console.log('calculated chargedFee      :', chargedFee.toString())
      const actualFee = toBN(value).sub(toBN(balanceRecieverAfter))
      // console.log('actual fee                 :', actualFee.toString())
      // const postRelayMaxCost = postRelayMaxGas.mul(gasPrice)
      // const actualFeeWithoutPostCall = actualFee.sub(postRelayMaxCost)
      // console.log('actualFeeWithoutPostCall   :', actualFeeWithoutPostCall.toString())
      networkFee.should.be.lt.BN(chargedFee)
      chargedFee.should.be.lt.BN(actualFee)

      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).sub(networkFee))
      balanceRelayerOwnerAfter.should.be.eq.BN(toBN(balanceRelayerOwnerBefore))
      balanceRecieverAfter.should.be.gt.BN(toBN(balanceRecieverBefore))
      balanceRecieverAfter.should.be.lt.BN(toBN(value).sub(chargedFee))
      balanceHubAfter.should.be.eq.BN(toBN(balanceHubBefore).add(actualFee))

      toBN(events.Withdraw.returnValues.nullifierHash).should.be.eq.BN(toBN(input.nullifierHash.toString()))
      events.Withdraw.returnValues.relayer.should.be.eq.BN(relayerAddress)
      events.Withdraw.returnValues.to.should.be.eq.BN(toHex(receiver.toString()))

      isSpent = await mixer.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(true)
    })

    it.skip('should work with relayer selection', async () => {
      // you should run a relayer or two manualy for this test
      // npx oz-gsn run-relayer --port 8888
      const gasPrice = toBN('20000000000')
      const deposit = generateDeposit()
      const user = accounts[4]
      await tree.insert(deposit.commitment)

      await mixer.deposit(toBN(deposit.commitment.toString()), { value, from: user, gasPrice })
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

      // create a provider to look up the relayers
      gsnProvider = new GSNProvider('http://localhost:8545', {
        signKey,
        relayerOwner: relayerOwnerAddress,
        relayerAddress,
        verbose: true
      })

      hubInstance = utils.createRelayHub(web3, relayHubAddress)
      gsnProvider.relayClient.serverHelper.setHub(hubInstance)
      let relays = await gsnProvider.relayClient.serverHelper.fetchRelaysAdded()
      console.log('all relays', relays)

      const { relayUrl, transactionFee } = relays[1]
      console.log('we are picking', relayUrl)
      let blockFrom = 0
      let pinger = await gsnProvider.relayClient.serverHelper.newActiveRelayPinger(blockFrom, relays[2].gasPrice)
      const predefinedRelay = await pinger.getRelayAddressPing(relayUrl, transactionFee, relays[2].gasPrice )
      console.log('relay status', predefinedRelay)

      // eslint-disable-next-line require-atomic-updates
      gsnProvider = new GSNProvider('http://localhost:8545', {
        signKey,
        relayerOwner: relayerOwnerAddress,
        relayerAddress,
        verbose: true,
        predefinedRelay // select the relay we want to work with
      })
      gsnWeb3 = new Web3(gsnProvider, null, { transactionConfirmationBlocks: 1 })
      gsnMixer = new gsnWeb3.eth.Contract(mixer.abi, mixer.address)

      const tx = await gsnMixer.methods.withdrawViaRelayer(pi_a, pi_b, pi_c, publicSignals).send({
        from: signKey.address,
        gas: 3e6,
        gasPrice,
        value: 0
      })
      console.log('tx succeed', tx.status)
    })

    it('uniswap mock test', async () => {
      const valueToBuy = toBN(toWei('0.04'))
      await token.approve(uniswap.address, tokenDenomination, { from: user, gasPrice: 0 })
      const tokens = await uniswap.getTokenToEthOutputPrice(valueToBuy)
      const balanceBefore = await web3.eth.getBalance(user)
      const tokenBalanceBefore = await token.balanceOf(user)
      await uniswap.tokenToEthSwapOutput(valueToBuy, 1, 2, { from: user, gasPrice: 0 })
      const balanceAfter = await web3.eth.getBalance(user)
      const tokenBalanceAfter = await token.balanceOf(user)
      balanceBefore.should.be.eq.BN(toBN(balanceAfter).sub(valueToBuy))
      tokenBalanceBefore.should.be.eq.BN(toBN(tokenBalanceAfter).add(toBN(tokens)))
      valueToBuy.mul(eth2daiPrice).div(toBN(toWei('1'))).should.be.eq.BN(tokens)
    })

    it.only('should work for token', async () => {
      const gasPrice = toBN('1')
      const deposit = generateDeposit()
      const user = accounts[4]
      await tree.insert(deposit.commitment)

      await token.mint(user, tokenDenomination)
      await token.approve(ercMixer.address, tokenDenomination, { from: user })
      await ercMixer.deposit(toBN(deposit.commitment.toString()), { value, from: user, gasPrice })

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

      const balanceMixerBefore = await web3.eth.getBalance(ercMixer.address)
      const balanceHubBefore = await web3.eth.getBalance(relayHubAddress)
      const balanceRelayerBefore = await web3.eth.getBalance(relayerAddress)
      const balanceRelayerOwnerBefore = await web3.eth.getBalance(relayerOwnerAddress)
      const balanceRecieverBefore = await web3.eth.getBalance(toHex(receiver.toString()))

      gsnProvider = new GSNDevProvider('http://localhost:8545', {
        signKey,
        relayerOwner: relayerOwnerAddress,
        relayerAddress,
        verbose: true,
        txFee: relayerTxFee
      })
      gsnWeb3 = new Web3(gsnProvider, null, { transactionConfirmationBlocks: 1 })
      gsnMixer = new gsnWeb3.eth.Contract(ercMixer.abi, ercMixer.address)

      const tx = await gsnMixer.methods.withdrawViaRelayer(pi_a, pi_b, pi_c, publicSignals).send({
        from: signKey.address,
        gas: 3e6,
        gasPrice,
        value: 0
      })
      console.log('tx', tx)
      const { gasUsed } = tx
      const balanceMixerAfter = await web3.eth.getBalance(ercMixer.address)
      const balanceHubAfter = await web3.eth.getBalance(relayHubAddress)
      const balanceRelayerAfter = await web3.eth.getBalance(relayerAddress)
      const balanceRelayerOwnerAfter = await web3.eth.getBalance(relayerOwnerAddress)
      const balanceRecieverAfter = await web3.eth.getBalance(toHex(receiver.toString()))
      // console.log('balanceMixerBefore, balanceMixerAfter', balanceMixerBefore.toString(), balanceMixerAfter.toString())
      // console.log('balanceRecieverBefore, balanceRecieverAfter', balanceRecieverBefore.toString(), balanceRecieverAfter.toString())
      // console.log('balanceHubBefore, balanceHubAfter', balanceHubBefore.toString(), balanceHubAfter.toString())
      // console.log('balanceRelayerBefore, balanceRelayerAfter', balanceRelayerBefore.toString(), balanceRelayerAfter.toString(), toBN(balanceRelayerBefore).sub(toBN(balanceRelayerAfter)).toString())
      // console.log('balanceRelayerOwnerBefore, balanceRelayerOwnerAfter', balanceRelayerOwnerBefore.toString(), balanceRelayerOwnerAfter.toString())
      balanceMixerAfter.should.be.eq.BN(toBN(balanceMixerBefore).sub(toBN(value)))
      const networkFee = toBN(gasUsed).mul(gasPrice)
      const chargedFee = networkFee.add(networkFee.div(toBN(relayerTxFee)))
      // console.log('networkFee                 :', networkFee.toString())
      // console.log('calculated chargedFee      :', chargedFee.toString())
      const actualFee = toBN(value).sub(toBN(balanceRecieverAfter))
      // console.log('actual fee                 :', actualFee.toString())
      // const postRelayMaxCost = postRelayMaxGas.mul(gasPrice)
      // const actualFeeWithoutPostCall = actualFee.sub(postRelayMaxCost)
      // console.log('actualFeeWithoutPostCall   :', actualFeeWithoutPostCall.toString())
      networkFee.should.be.lt.BN(chargedFee)
      chargedFee.should.be.lt.BN(actualFee)

      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).sub(networkFee))
      balanceRelayerOwnerAfter.should.be.eq.BN(toBN(balanceRelayerOwnerBefore))
      balanceRecieverAfter.should.be.gt.BN(toBN(balanceRecieverBefore))
      balanceRecieverAfter.should.be.lt.BN(toBN(value).sub(chargedFee))
      balanceHubAfter.should.be.eq.BN(toBN(balanceHubBefore).add(actualFee))
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
