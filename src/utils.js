const crypto = require('crypto')
const Decimal = require('decimal.js')
const {bigInt} = require('snarkjs')
const {toBN, soliditySha3} = require('web3-utils')
const Web3 = require('web3')
const web3 = new Web3()
const {babyJub, pedersenHash, mimcsponge, poseidon} = require('circomlib')

const RewardExtData = {
  RewardExtData: {
    relayer: 'address',
    encryptedAccount: 'bytes',
  },
}
const AccountUpdate = {
  AccountUpdate: {
    inputRoot: 'bytes32',
    inputNullifierHash: 'bytes32',
    outputRoot: 'bytes32',
    outputPathIndices: 'uint256',
    outputCommitment: 'bytes32',
  },
}
const RewardArgs = {
  RewardArgs: {
    rate: 'uint256',
    fee: 'uint256',
    instance: 'address',
    rewardNullifier: 'bytes32',
    extDataHash: 'bytes32',
    depositRoot: 'bytes32',
    withdrawalRoot: 'bytes32',
    extData: RewardExtData.RewardExtData,
    account: AccountUpdate.AccountUpdate,
  },
}

const WithdrawExtData = {
  WithdrawExtData: {
    fee: 'uint256',
    recipient: 'address',
    relayer: 'address',
    encryptedAccount: 'bytes',
  },
}

const pedersenHashBuffer = (buffer) => toBN(babyJub.unpackPoint(pedersenHash.hash(buffer))[0].toString())

const mimcHash = (items) => toBN(mimcsponge.multiHash(items.map((item) => bigInt(item))).toString())

const poseidonHash = (items) => toBN(poseidon(items).toString())

const poseidonHash2 = (a, b) => poseidonHash([a, b])

/** Generate random number of specified byte length */
const randomBN = (nbytes = 31) => toBN(bigInt.leBuff2int(crypto.randomBytes(nbytes)).toString())

/** BigNumber to hex string of specified length */
const toFixedHex = (number, length = 32) =>
  '0x' +
  (number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)).padStart(length * 2, '0')

function getExtRewardArgsHash({relayer, encryptedAccount}) {
  const encodedData = web3.eth.abi.encodeParameters(
    [RewardExtData],
    [{relayer: toFixedHex(relayer, 20), encryptedAccount}],
  )
  const hash = soliditySha3({t: 'bytes', v: encodedData})
  return '0x00' + hash.slice(4) // cut last byte to make it 31 byte long to fit the snark field
}

function getExtWithdrawArgsHash({fee, recipient, relayer, encryptedAccount}) {
  const encodedData = web3.eth.abi.encodeParameters(
    [WithdrawExtData],
    [
      {
        fee: toFixedHex(fee, 32),
        recipient: toFixedHex(recipient, 20),
        relayer: toFixedHex(relayer, 20),
        encryptedAccount,
      },
    ],
  )
  const hash = soliditySha3({t: 'bytes', v: encodedData})
  return '0x00' + hash.slice(4) // cut first byte to make it 31 byte long to fit the snark field
}

function packEncryptedMessage(encryptedMessage) {
  const nonceBuf = Buffer.from(encryptedMessage.nonce, 'base64')
  const ephemPublicKeyBuf = Buffer.from(encryptedMessage.ephemPublicKey, 'base64')
  const ciphertextBuf = Buffer.from(encryptedMessage.ciphertext, 'base64')
  const messageBuff = Buffer.concat([
    Buffer.alloc(24 - nonceBuf.length),
    nonceBuf,
    Buffer.alloc(32 - ephemPublicKeyBuf.length),
    ephemPublicKeyBuf,
    ciphertextBuf,
  ])
  return '0x' + messageBuff.toString('hex')
}

function unpackEncryptedMessage(encryptedMessage) {
  if (encryptedMessage.slice(0, 2) === '0x') {
    encryptedMessage = encryptedMessage.slice(2)
  }
  const messageBuff = Buffer.from(encryptedMessage, 'hex')
  const nonceBuf = messageBuff.slice(0, 24)
  const ephemPublicKeyBuf = messageBuff.slice(24, 56)
  const ciphertextBuf = messageBuff.slice(56)
  return {
    version: 'x25519-xsalsa20-poly1305',
    nonce: nonceBuf.toString('base64'),
    ephemPublicKey: ephemPublicKeyBuf.toString('base64'),
    ciphertext: ciphertextBuf.toString('base64'),
  }
}

function bitsToNumber(bits) {
  let result = 0
  for (const item of bits.slice().reverse()) {
    result = (result << 1) + item
  }
  return result
}

// a = floor(10**18 * e^(-0.0000000001 * amount))
// yield = BalBefore - (BalBefore * a)/10**18
function tornadoFormula({balance, amount, poolWeight = 1e10}) {
  const decimals = new Decimal(10 ** 18)
  balance = new Decimal(balance.toString())
  amount = new Decimal(amount.toString())
  poolWeight = new Decimal(poolWeight.toString())

  const power = amount.div(poolWeight).negated()
  const exponent = Decimal.exp(power).mul(decimals)
  const newBalance = balance.mul(exponent).div(decimals)
  return toBN(balance.sub(newBalance).toFixed(0))
}

function reverseTornadoFormula({balance, tokens, poolWeight = 1e10}) {
  balance = new Decimal(balance.toString())
  tokens = new Decimal(tokens.toString())
  poolWeight = new Decimal(poolWeight.toString())

  return toBN(poolWeight.times(Decimal.ln(balance.div(balance.sub(tokens)))).toFixed(0))
}

module.exports = {
  randomBN,
  pedersenHashBuffer,
  bitsToNumber,
  getExtRewardArgsHash,
  getExtWithdrawArgsHash,
  packEncryptedMessage,
  unpackEncryptedMessage,
  toFixedHex,
  mimcHash,
  poseidonHash,
  poseidonHash2,
  tornadoFormula,
  reverseTornadoFormula,
  RewardArgs,
  RewardExtData,
  AccountUpdate,
}
