// This file is a bit of a mess because of different bigInt formats in websnark and snarkjs
// It will be rewritten during browser integration

const fs = require('fs');
const circom = require("circom");
const snarkjs = require("snarkjs");
const groth = snarkjs["groth"];
const crypto = require("crypto");
const circomlib = require('circomlib');
const pedersen = circomlib.pedersenHash;
const babyjub = circomlib.babyJub;
const bigInt = snarkjs.bigInt;
const buildGroth16 = require('websnark/src/groth16');
const websnarkUtils = require('websnark/src/utils');
const stringifyBigInts = require("websnark/tools/stringifybigint").stringifyBigInts;
const unstringifyBigInts = require("websnark/tools/stringifybigint").unstringifyBigInts;
const stringifyBigInts2 = require("snarkjs/src/stringifybigint").stringifyBigInts;
const unstringifyBigInts2 = require("snarkjs/src/stringifybigint").unstringifyBigInts;

const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes));
const pedersenHash = (data) => babyjub.unpackPoint(pedersen.hash(data))[0];

async function snarkProof(input) {
  const witness = require("../build/circuits/withdraw.json");
  const pwd = process.cwd();
  let pathToProvingKey = 'build/circuits/withdraw_proving_key.bin';
  if (pwd.split('/').pop() === 'scripts') {
    pathToProvingKey = '../build/circuits/withdraw_proving_key.bin'
  }
  const proving_key = fs.readFileSync(pathToProvingKey);

  const groth16 = await buildGroth16();
  let proof = await websnarkUtils.genWitnessAndProve(groth16, input, witness, proving_key.buffer);

  return websnarkUtils.toSolidityInput(proof);
}

async function snarkVerify(proof) {
  proof = unstringifyBigInts2(websnarkUtils.fromSolidityInput(proof));
  const verification_key = unstringifyBigInts2(require('../build/circuits/withdraw_verification_key.json'));
  return groth.isValid(verification_key, proof, proof.publicSignals);
}

module.exports = {rbigint, pedersenHash, snarkProof, snarkVerify};
