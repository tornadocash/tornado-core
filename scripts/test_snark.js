const fs = require('fs');
const circom = require("circom");
const snarkjs = require("snarkjs");
const circomlib = require('circomlib');
const bigInt = snarkjs.bigInt;
const stringifyBigInts = require("websnark/tools/stringifybigint").stringifyBigInts;
const unstringifyBigInts = require("websnark/tools/stringifybigint").unstringifyBigInts;
const utils = require("./utils");
const merkleTree = require('../lib/MerkleTree');
const jsStorage = require("../lib/Storage");
const mimcHasher = require("../lib/MiMC");

function generateDeposit() {
  let deposit = {
    secret: utils.rbigint(31),
    nullifier: utils.rbigint(31),
  };
  const preimage = Buffer.concat([deposit.nullifier.leInt2Buff(32), deposit.secret.leInt2Buff(32)]);
  deposit.commitment = utils.pedersenHash(preimage);
  return deposit;
}

(async () => {
  const dep1 = generateDeposit();
  const dep2 = generateDeposit();
  const dep3 = generateDeposit();

  const tree = new merkleTree("", new jsStorage(), new mimcHasher(), 16, 0);

  await tree.insert(dep1.commitment);
  await tree.insert(dep2.commitment);
  await tree.insert(dep3.commitment);

  const {root, path_elements, path_index} = await tree.path(1);

  // Circuit input
  const input = stringifyBigInts({
    // public
    root: root,
    nullifier: dep2.nullifier,
    receiver: utils.rbigint(20),
    fee: bigInt(1e17),

    // private
    secret: dep2.secret,
    pathElements: path_elements,
    pathIndex: path_index,
  });

  console.log("Input:\n", input);
  console.time("Time");
  const proof = await utils.snarkProof(input);
  console.log("Proof:\n", proof);
  console.timeEnd("Time");
})();
