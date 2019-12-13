/* global artifacts, web3, contract */
require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()
const fs = require('fs')

const { toBN } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('../lib/ganacheHelper')

const Tornado = artifacts.require('./ERC20Tornado.sol')
const BadRecipient = artifacts.require('./BadRecipient.sol')
const Token = artifacts.require('./ERC20Mock.sol')
const USDTToken = artifacts.require('./IUSDT.sol')
const { ETH_AMOUNT, TOKEN_AMOUNT, MERKLE_TREE_HEIGHT, ERC20_TOKEN } = process.env

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
const toFixedHex = (number, length = 32) =>  '0x' + bigInt(number).toString(16).padStart(length * 2, '0')
const getRandomRecipient = () => rbigint(20)

function generateDeposit() {
  let deposit = {
    secret: rbigint(31),
    nullifier: rbigint(31),
  }
  const preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(preimage)
  return deposit
}

contract('ERC20Tornado', accounts => {
  let tornado
  let token
  let usdtToken
  let badRecipient
  const sender = accounts[0]
  const operator = accounts[0]
  const levels = MERKLE_TREE_HEIGHT || 16
  let tokenDenomination = TOKEN_AMOUNT || '1000000000000000000' // 1 ether
  let snapshotId
  let prefix = 'test'
  let tree
  const fee = bigInt(ETH_AMOUNT).shr(1) || bigInt(1e17)
  const refund = ETH_AMOUNT || '1000000000000000000' // 1 ether
  let recipient = getRandomRecipient()
  const relayer = accounts[1]
  let groth16
  let circuit
  let proving_key

  before(async () => {
    tree = new MerkleTree(
      levels,
      null,
      prefix,
    )
    tornado = await Tornado.deployed()
    if (ERC20_TOKEN) {
      token = await Token.at(ERC20_TOKEN)
      usdtToken = await USDTToken.at(ERC20_TOKEN)
    } else {
      token = await Token.deployed()
      await token.mint(sender, tokenDenomination)
    }
    badRecipient = await BadRecipient.new()
    snapshotId = await takeSnapshot()
    groth16 = await buildGroth16()
    circuit = require('../build/circuits/withdraw.json')
    proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const tokenFromContract = await tornado.token()
      tokenFromContract.should.be.equal(token.address)
    })
  })

  describe('#deposit', () => {
    it('should work', async () => {
      const commitment = toFixedHex(43)
      await token.approve(tornado.address, tokenDenomination)

      let { logs } = await tornado.deposit(commitment, { from: sender })

      logs[0].event.should.be.equal('Deposit')
      logs[0].args.commitment.should.be.equal(commitment)
      logs[0].args.leafIndex.should.be.eq.BN(0)
    })

    it('should not allow to send ether on deposit', async () => {
      const commitment = toFixedHex(43)
      await token.approve(tornado.address, tokenDenomination)

      let error = await tornado.deposit(commitment, { from: sender, value: 1e6 }).should.be.rejected
      error.reason.should.be.equal('ETH value is supposed to be 0 for ERC20 instance')
    })
  })

  describe('#withdraw', () => {
    it('should work', async () => {
      const deposit = generateDeposit()
      const user = accounts[4]
      await tree.insert(deposit.commitment)
      await token.mint(user, tokenDenomination)

      const balanceUserBefore = await token.balanceOf(user)
      await token.approve(tornado.address, tokenDenomination, { from: user })
      // Uncomment to measure gas usage
      // let gas = await tornado.deposit.estimateGas(toBN(deposit.commitment.toString()), { from: user, gasPrice: '0' })
      // console.log('deposit gas:', gas)
      await tornado.deposit(toFixedHex(deposit.commitment), { from: user, gasPrice: '0' })

      const balanceUserAfter = await token.balanceOf(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(tokenDenomination)))

      const { root, path_elements, path_index } = await tree.path(0)
      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer,
        recipient,
        fee,
        refund,

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })


      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const balanceTornadoBefore = await token.balanceOf(tornado.address)
      const balanceRelayerBefore = await token.balanceOf(relayer)
      const balanceRecieverBefore = await token.balanceOf(toFixedHex(recipient, 20))

      const ethBalanceOperatorBefore = await web3.eth.getBalance(operator)
      const ethBalanceRecieverBefore = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const ethBalanceRelayerBefore = await web3.eth.getBalance(relayer)
      let isSpent = await tornado.isSpent(toFixedHex(input.nullifierHash))
      isSpent.should.be.equal(false)
      // Uncomment to measure gas usage
      // gas = await tornado.withdraw.estimateGas(proof, publicSignals, { from: relayer, gasPrice: '0' })
      // console.log('withdraw gas:', gas)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const { logs } = await tornado.withdraw(proof, ...args, { value: refund, from: relayer, gasPrice: '0' })

      const balanceTornadoAfter = await token.balanceOf(tornado.address)
      const balanceRelayerAfter = await token.balanceOf(relayer)
      const ethBalanceOperatorAfter = await web3.eth.getBalance(operator)
      const balanceRecieverAfter = await token.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceRecieverAfter = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const ethBalanceRelayerAfter = await web3.eth.getBalance(relayer)
      const feeBN = toBN(fee.toString())
      balanceTornadoAfter.should.be.eq.BN(toBN(balanceTornadoBefore).sub(toBN(tokenDenomination)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).add(feeBN))
      balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(tokenDenomination).sub(feeBN)))

      ethBalanceOperatorAfter.should.be.eq.BN(toBN(ethBalanceOperatorBefore))
      ethBalanceRecieverAfter.should.be.eq.BN(toBN(ethBalanceRecieverBefore).add(toBN(refund)))
      ethBalanceRelayerAfter.should.be.eq.BN(toBN(ethBalanceRelayerBefore).sub(toBN(refund)))

      logs[0].event.should.be.equal('Withdrawal')
      logs[0].args.nullifierHash.should.be.equal(toFixedHex(input.nullifierHash))
      logs[0].args.relayer.should.be.eq.BN(relayer)
      logs[0].args.fee.should.be.eq.BN(feeBN)
      isSpent = await tornado.isSpent(toFixedHex(input.nullifierHash))
      isSpent.should.be.equal(true)
    })

    it('should return refund to the relayer is case of fail', async () => {
      const deposit = generateDeposit()
      const user = accounts[4]
      recipient = bigInt(badRecipient.address)
      await tree.insert(deposit.commitment)
      await token.mint(user, tokenDenomination)

      const balanceUserBefore = await token.balanceOf(user)
      await token.approve(tornado.address, tokenDenomination, { from: user })
      await tornado.deposit(toFixedHex(deposit.commitment), { from: user, gasPrice: '0' })

      const balanceUserAfter = await token.balanceOf(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(tokenDenomination)))

      const { root, path_elements, path_index } = await tree.path(0)
      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer,
        recipient,
        fee,
        refund,

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })


      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const balanceTornadoBefore = await token.balanceOf(tornado.address)
      const balanceRelayerBefore = await token.balanceOf(relayer)
      const balanceRecieverBefore = await token.balanceOf(toFixedHex(recipient, 20))

      const ethBalanceOperatorBefore = await web3.eth.getBalance(operator)
      const ethBalanceRecieverBefore = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const ethBalanceRelayerBefore = await web3.eth.getBalance(relayer)
      let isSpent = await tornado.isSpent(toFixedHex(input.nullifierHash))
      isSpent.should.be.equal(false)

      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const { logs } = await tornado.withdraw(proof, ...args, { value: refund, from: relayer, gasPrice: '0' })

      const balanceTornadoAfter = await token.balanceOf(tornado.address)
      const balanceRelayerAfter = await token.balanceOf(relayer)
      const ethBalanceOperatorAfter = await web3.eth.getBalance(operator)
      const balanceRecieverAfter = await token.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceRecieverAfter = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const ethBalanceRelayerAfter = await web3.eth.getBalance(relayer)
      const feeBN = toBN(fee.toString())
      balanceTornadoAfter.should.be.eq.BN(toBN(balanceTornadoBefore).sub(toBN(tokenDenomination)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).add(feeBN))
      balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(tokenDenomination).sub(feeBN)))

      ethBalanceOperatorAfter.should.be.eq.BN(toBN(ethBalanceOperatorBefore))
      ethBalanceRecieverAfter.should.be.eq.BN(toBN(ethBalanceRecieverBefore))
      ethBalanceRelayerAfter.should.be.eq.BN(toBN(ethBalanceRelayerBefore))

      logs[0].event.should.be.equal('Withdrawal')
      logs[0].args.nullifierHash.should.be.equal(toFixedHex(input.nullifierHash))
      logs[0].args.relayer.should.be.eq.BN(relayer)
      logs[0].args.fee.should.be.eq.BN(feeBN)
      isSpent = await tornado.isSpent(toFixedHex(input.nullifierHash))
      isSpent.should.be.equal(true)
    })

    it('should reject with wrong refund value', async () => {
      const deposit = generateDeposit()
      const user = accounts[4]
      await tree.insert(deposit.commitment)
      await token.mint(user, tokenDenomination)
      await token.approve(tornado.address, tokenDenomination, { from: user })
      await tornado.deposit(toFixedHex(deposit.commitment), { from: user, gasPrice: '0' })


      const { root, path_elements, path_index } = await tree.path(0)
      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer,
        recipient,
        fee,
        refund,

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })


      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      let { reason } = await tornado.withdraw(proof, ...args, { value: 1, from: relayer, gasPrice: '0' }).should.be.rejected
      reason.should.be.equal('Incorrect refund amount received by the contract')


      ;({ reason } = await tornado.withdraw(proof, ...args, { value: toBN(refund).mul(toBN(2)), from: relayer, gasPrice: '0' }).should.be.rejected)
      reason.should.be.equal('Incorrect refund amount received by the contract')
    })

    it.skip('should work with REAL USDT', async () => {
      // dont forget to specify your token in .env
      // USDT decimals is 6, so TOKEN_AMOUNT=1000000
      // and sent `tokenDenomination` to accounts[0] (0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1)
      // run ganache as
      // ganache-cli --fork https://kovan.infura.io/v3/27a9649f826b4e31a83e07ae09a87448@13147586  -d --keepAliveTimeout 20
      const deposit = generateDeposit()
      const user = accounts[4]
      const userBal = await usdtToken.balanceOf(user)
      console.log('userBal', userBal.toString())
      const senderBal = await usdtToken.balanceOf(sender)
      console.log('senderBal', senderBal.toString())
      await tree.insert(deposit.commitment)
      await usdtToken.transfer(user, tokenDenomination, { from: sender })
      console.log('transfer done')

      const balanceUserBefore = await usdtToken.balanceOf(user)
      console.log('balanceUserBefore', balanceUserBefore.toString())
      await usdtToken.approve(tornado.address, tokenDenomination, { from: user })
      console.log('approve done')
      const allowanceUser = await usdtToken.allowance(user, tornado.address)
      console.log('allowanceUser', allowanceUser.toString())
      await tornado.deposit(toFixedHex(deposit.commitment), { from: user, gasPrice: '0' })
      console.log('deposit done')

      const balanceUserAfter = await usdtToken.balanceOf(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(tokenDenomination)))

      const { root, path_elements, path_index } = await tree.path(0)

      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer: operator,
        recipient,
        fee,
        refund,

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })


      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const balanceTornadoBefore = await usdtToken.balanceOf(tornado.address)
      const balanceRelayerBefore = await usdtToken.balanceOf(relayer)
      const ethBalanceOperatorBefore = await web3.eth.getBalance(operator)
      const balanceRecieverBefore = await usdtToken.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceRecieverBefore = await web3.eth.getBalance(toFixedHex(recipient, 20))
      let isSpent = await tornado.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(false)

      // Uncomment to measure gas usage
      // gas = await tornado.withdraw.estimateGas(proof, publicSignals, { from: relayer, gasPrice: '0' })
      // console.log('withdraw gas:', gas)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const { logs } = await tornado.withdraw(proof, ...args, { value: refund, from: relayer, gasPrice: '0' })

      const balanceTornadoAfter = await usdtToken.balanceOf(tornado.address)
      const balanceRelayerAfter = await usdtToken.balanceOf(relayer)
      const ethBalanceOperatorAfter = await web3.eth.getBalance(operator)
      const balanceRecieverAfter = await usdtToken.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceRecieverAfter = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const feeBN = toBN(fee.toString())
      balanceTornadoAfter.should.be.eq.BN(toBN(balanceTornadoBefore).sub(toBN(tokenDenomination)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore))
      ethBalanceOperatorAfter.should.be.eq.BN(toBN(ethBalanceOperatorBefore).add(feeBN))
      balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(tokenDenomination)))
      ethBalanceRecieverAfter.should.be.eq.BN(toBN(ethBalanceRecieverBefore).add(toBN(refund)).sub(feeBN))


      logs[0].event.should.be.equal('Withdrawal')
      logs[0].args.nullifierHash.should.be.eq.BN(toBN(input.nullifierHash.toString()))
      logs[0].args.relayer.should.be.eq.BN(operator)
      logs[0].args.fee.should.be.eq.BN(feeBN)
      isSpent = await tornado.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(true)
    })
    it.skip('should work with REAL DAI', async () => {
      // dont forget to specify your token in .env
      // and send `tokenDenomination` to accounts[0] (0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1)
      // run ganache as
      // npx ganache-cli --fork https://kovan.infura.io/v3/27a9649f826b4e31a83e07ae09a87448@13146218 -d --keepAliveTimeout 20
      const deposit = generateDeposit()
      const user = accounts[4]
      const userBal = await token.balanceOf(user)
      console.log('userBal', userBal.toString())
      const senderBal = await token.balanceOf(sender)
      console.log('senderBal', senderBal.toString())
      await tree.insert(deposit.commitment)
      await token.transfer(user, tokenDenomination, { from: sender })
      console.log('transfer done')

      const balanceUserBefore = await token.balanceOf(user)
      console.log('balanceUserBefore', balanceUserBefore.toString())
      await token.approve(tornado.address, tokenDenomination, { from: user })
      console.log('approve done')
      await tornado.deposit(toFixedHex(deposit.commitment), { from: user, gasPrice: '0' })
      console.log('deposit done')

      const balanceUserAfter = await token.balanceOf(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(tokenDenomination)))

      const { root, path_elements, path_index } = await tree.path(0)

      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer: operator,
        recipient,
        fee,
        refund,

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      })


      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)

      const balanceTornadoBefore = await token.balanceOf(tornado.address)
      const balanceRelayerBefore = await token.balanceOf(relayer)
      const ethBalanceOperatorBefore = await web3.eth.getBalance(operator)
      const balanceRecieverBefore = await token.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceRecieverBefore = await web3.eth.getBalance(toFixedHex(recipient, 20))
      let isSpent = await tornado.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(false)

      // Uncomment to measure gas usage
      // gas = await tornado.withdraw.estimateGas(proof, publicSignals, { from: relayer, gasPrice: '0' })
      // console.log('withdraw gas:', gas)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ]
      const { logs } = await tornado.withdraw(proof, ...args, { value: refund, from: relayer, gasPrice: '0' })
      console.log('withdraw done')

      const balanceTornadoAfter = await token.balanceOf(tornado.address)
      const balanceRelayerAfter = await token.balanceOf(relayer)
      const ethBalanceOperatorAfter = await web3.eth.getBalance(operator)
      const balanceRecieverAfter = await token.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceRecieverAfter = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const feeBN = toBN(fee.toString())
      balanceTornadoAfter.should.be.eq.BN(toBN(balanceTornadoBefore).sub(toBN(tokenDenomination)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore))
      ethBalanceOperatorAfter.should.be.eq.BN(toBN(ethBalanceOperatorBefore).add(feeBN))
      balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(tokenDenomination)))
      ethBalanceRecieverAfter.should.be.eq.BN(toBN(ethBalanceRecieverBefore).add(toBN(refund)).sub(feeBN))


      logs[0].event.should.be.equal('Withdrawal')
      logs[0].args.nullifierHash.should.be.eq.BN(toBN(input.nullifierHash.toString()))
      logs[0].args.relayer.should.be.eq.BN(operator)
      logs[0].args.fee.should.be.eq.BN(feeBN)
      isSpent = await tornado.isSpent(input.nullifierHash.toString(16).padStart(66, '0x00000'))
      isSpent.should.be.equal(true)
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    // eslint-disable-next-line require-atomic-updates
    snapshotId = await takeSnapshot()
    tree = new MerkleTree(
      levels,
      null,
      prefix,
    )
  })
})
