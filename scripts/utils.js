const snarkjs = require("snarkjs");
const groth = snarkjs["groth"];
const crypto = require("crypto");
const circomlib = require('circomlib');
const pedersen = circomlib.pedersenHash;
const babyjub = circomlib.babyJub;
const websnarkUtils = require('websnark/src/utils');
const unstringifyBigInts2 = require("snarkjs/src/stringifybigint").unstringifyBigInts;

const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes));
const pedersenHash = (data) => babyjub.unpackPoint(pedersen.hash(data))[0];

async function snarkVerify(proof) {
  proof = unstringifyBigInts2(websnarkUtils.fromSolidityInput(proof));
  const verification_key = unstringifyBigInts2(require('../build/circuits/withdraw_verification_key.json'));
  return groth.isValid(verification_key, proof, proof.publicSignals);
}

module.exports = {rbigint, pedersenHash, snarkProof, snarkVerify};
