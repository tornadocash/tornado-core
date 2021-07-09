const { getEncryptionPublicKey } = require('eth-sig-util')
const { toBN } = require('web3-utils')

const Account = require('../src/account')
const {
  packEncryptedMessage,
  unpackEncryptedMessage,
} = require('../src/utils')

describe('#encrypt', () => {
  // EncryptedNote
  const privateKey = web3.eth.accounts.create().privateKey.slice(2)
  const publicKey = getEncryptionPublicKey(privateKey)

  it('should work', () => {
    const account = new Account()
    const encryptedAccount = account.encrypt(publicKey)
    const encryptedMessage = packEncryptedMessage(encryptedAccount)
    const unpackedMessage = unpackEncryptedMessage(encryptedMessage)
    const account2 = Account.decrypt(privateKey, unpackedMessage)

    assert(account.amount.toString() === toBN(account2.amount).toString())
    assert(account.secret.toString() === toBN(account2.secret).toString())
    assert(account.nullifier.toString() === toBN(account2.nullifier).toString())
    assert(account.commitment.toString() === toBN(account2.commitment).toString())
  })
})

