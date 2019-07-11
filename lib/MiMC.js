const circomlib = require('circomlib');
const mimcsponge = circomlib.mimcsponge;
const snarkjs = require('snarkjs');

const bigInt = snarkjs.bigInt;

class MimcSpongeHasher {
    hash(level, left, right) {
        return mimcsponge.multiHash([bigInt(left), bigInt(right)]).toString();
    }
}

module.exports = MimcSpongeHasher;