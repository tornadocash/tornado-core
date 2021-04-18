const {toBN} = require('web3-utils')
const {encrypt, decrypt} = require('eth-sig-util')
const {randomBN, poseidonHash} = require('./utils')

class Account {
  constructor({amount, secret, nullifier} = {}) {
    this.amount = amount ? toBN(amount) : toBN('0')
    this.secret = secret ? toBN(secret) : randomBN(31)
    this.nullifier = nullifier ? toBN(nullifier) : randomBN(31)

    this.commitment = poseidonHash([this.amount, this.secret, this.nullifier])
    this.nullifierHash = poseidonHash([this.nullifier])

    if (this.amount.lt(toBN(0))) {
      throw new Error('Cannot create an account with negative amount')
    }
  }

  encrypt(pubkey) {
    const bytes = Buffer.concat([
      this.amount.toBuffer('be', 31),
      this.secret.toBuffer('b', 31),
      this.nullifier.toBuffer('be', 31),
    ])
    return encrypt(pubkey, {data: bytes.toString('base64')}, 'x25519-xsalsa20-poly1305')
  }

  static decrypt(privkey, data) {
    const decryptedMessage = decrypt(data, privkey)
    const buf = Buffer.from(decryptedMessage, 'base64')
    return new Account({
      amount: toBN('0x' + buf.slice(0, 31).toString('hex')),
      secret: toBN('0x' + buf.slice(31, 62).toString('hex')),
      nullifier: toBN('0x' + buf.slice(62, 93).toString('hex')),
    })
  }
}

module.exports = Account
