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

const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes));

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
  const buffLen = witness.length * 32;
  const buff = new ArrayBuffer(buffLen);
  const h = {
    dataView: new DataView(buff),
    offset: 0
  };
  for (let i=0; i<witness.length; i++) {
    for (let i=0; i<8; i++) {
      //const v = witness[i].shiftRight(i*32).and(0xFFFFFFFF).toJSNumber();
      const v = Number(witness[i].shr(i * 32).and(BigInt(0xFFFFFFFF)));
      h.dataView.setUint32(h.offset, v, true);
      h.offset += 4;
    }
  }
  return buff;
}

function toArrayBuffer(b) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

async function snarkProof(input) {
  const circuit = new snarkjs.Circuit(unstringifyBigInts(require("../build/circuits/withdraw.json")));
  const witnessArray = circuit.calculateWitness(input);
  const witness = convertWitness(witnessArray);
  const publicSignals = witnessArray.slice(1, circuit.nPubInputs + circuit.nOutputs + 1);
  const key = toArrayBuffer(fs.readFileSync("build/circuits/withdraw_proving_key.bin"));
  const groth16 = await buildGroth16();
  let proof = await groth16.proof(witness, key);
  proof = unstringifyBigInts(proof);
  return p256({
    pi_a: [proof.pi_a[0], proof.pi_a[1]],
    pi_b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
    pi_c: [proof.pi_c[0], proof.pi_c[1]],
    publicSignals: publicSignals,
  });
}

module.exports = {rbigint, pedersenHash, snarkProof, mimcHash};
