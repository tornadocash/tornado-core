const MiMC = require('./MiMC')
const snarkjs = require('snarkjs')

const hasher = new MiMC()
const bigInt = snarkjs.bigInt

const toHex = (number, length = 32) =>
  '0x' +
  (number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)).padStart(length * 2, '0')

function zeros(
  levels,
  defaultZero = '21663839004416932945382355908790599225266501822907911457504978515578255421292',
) {
  const zeros = []

  let currentZero = defaultZero
  for (let i = 0; i < levels; i++) {
    zeros.push(toHex(currentZero))
    currentZero = hasher.hash(levels, currentZero, currentZero)
  }

  return zeros
}

// console.log(zeros(32))

module.exports = { zeros, toHex }
