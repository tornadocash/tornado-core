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
const mimcsponge = circomlib.mimcsponge;
const bigInt = snarkjs.bigInt;
const buildGroth16 = require('websnark/src/groth16');
const stringifyBigInts = require("websnark/tools/stringifybigint").stringifyBigInts;
const unstringifyBigInts = require("websnark/tools/stringifybigint").unstringifyBigInts;
const stringifyBigInts2 = require("snarkjs/src/stringifybigint").stringifyBigInts;
const unstringifyBigInts2 = require("snarkjs/src/stringifybigint").unstringifyBigInts;

const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes));

function unhexBigInts(o) {
  if ((typeof(o) == "string") && (/^0x[0-9a-fA-F]+$/.test(o)))  {
    return bigInt(o);
  } else if (Array.isArray(o)) {
    return o.map(unhexBigInts);
  } else if (typeof o == "object") {
    const res = {};
    for (let k in o) {
      res[k] = unhexBigInts(o[k]);
    }
    return res;
  } else {
    return o;
  }
}

function pedersenHash(data) {
  return babyjub.unpackPoint(pedersen.hash(data))[0];
}


function mimcHash(left, right) {
  return mimcsponge.multiHash([bigInt(left), bigInt(right)]).toString();
}

function p256(o) {
  if ((typeof(o) == "bigint") || (o instanceof bigInt))  {
    let nstr = o.toString(16);
    while (nstr.length < 64) nstr = "0"+nstr;
    nstr = "0x"+nstr;
    return nstr;
  } else if (Array.isArray(o)) {
    return o.map(p256);
  } else if (typeof o == "object") {
    const res = {};
    for (let k in o) {
      if (k === "value") {
        return p256(o[k]);
      }
      res[k] = p256(o[k]);
    }
    return res;
  } else {
    return o;
  }
}

function convertWitness(witness) {
  witness = unstringifyBigInts(witness);
  const buffLen = witness.length * 32;
  const buff = new ArrayBuffer(buffLen);
  const h = {
    dataView: new DataView(buff),
    offset: 0
  };
  for (let i=0; i<witness.length; i++) {
    for (let j=0; j<8; j++) {
      const v = witness[i].shiftRight(j*32).and(0xFFFFFFFF).toJSNumber();
      h.dataView.setUint32(h.offset, v, true);
      h.offset += 4;
    }
  }
  return buff;
}

async function snarkProof(input) {
  input = unstringifyBigInts2(input);
  const circuit = new snarkjs.Circuit(unstringifyBigInts2(require("../build/circuits/withdraw.json")));
  const pwd = process.cwd()
  let pathToProvingKey = 'build/circuits/withdraw_proving_key.bin'
  if (pwd.split('/').pop() === 'scripts') {
    pathToProvingKey = '../build/circuits/withdraw_proving_key.bin'
  }
  const proving_key = fs.readFileSync(pathToProvingKey);

  const witness = circuit.calculateWitness(input);
  const witnessBin = convertWitness(stringifyBigInts2(witness));
  const publicSignals = witness.slice(1, circuit.nPubInputs + circuit.nOutputs + 1);

  const groth16 = await buildGroth16();
  let proof = await groth16.proof(witnessBin, proving_key.buffer);
  return p256(unstringifyBigInts2(stringifyBigInts({
    pi_a: [proof.pi_a[0], proof.pi_a[1]],
    pi_b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
    pi_c: [proof.pi_c[0], proof.pi_c[1]],
    publicSignals: publicSignals,
  })));
}

async function snarkVerify(proof) {
  proof = unhexBigInts(proof);
  const verification_key = unstringifyBigInts2(require('../build/circuits/withdraw_verification_key.json'));
  const data = {
    pi_a: [proof.pi_a[0], proof.pi_a[1], bigInt(1)],
    pi_b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]], [bigInt(1), bigInt(0)]],
    pi_c: [proof.pi_c[0], proof.pi_c[1], bigInt(1)]
  };
  return groth.isValid(verification_key, data, proof.publicSignals);
}

module.exports = {rbigint, pedersenHash, snarkProof, mimcHash, snarkVerify, unhexBigInts};
