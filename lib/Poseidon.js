const poseidon = require('circomlib/src/poseidon')
const snarkjs = require('snarkjs')

const bigInt = snarkjs.bigInt

class PoseidonHasher {
  hash(level, left, right) {
    const hash = poseidon.createHash(3, 8, 57)
    return hash([bigInt(left), bigInt(right)]).toString()
  }
}

module.exports = PoseidonHasher
