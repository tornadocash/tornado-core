const assert = require('assert');
const snarkjs = require("snarkjs");
const bigInt = snarkjs.bigInt;
const utils = require("./utils");
const merkleTree = require('../lib/MerkleTree');

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
  // === Create 3 deposits ===
  const dep1 = generateDeposit();
  const dep2 = generateDeposit();
  const dep3 = generateDeposit();

  const tree = new merkleTree(16);

  await tree.insert(dep1.commitment);
  await tree.insert(dep2.commitment);
  await tree.insert(dep3.commitment);

  // === Withdrawing deposit 2 ===
  const {root, path_elements, path_index} = await tree.path(1);

  // Circuit input
  const input = {
    // public
    root: root,
    nullifier: dep2.nullifier,
    receiver: utils.rbigint(20),
    fee: bigInt(1e17),

    // private
    secret: dep2.secret,
    pathElements: path_elements,
    pathIndex: path_index,
  };

  console.log("Input:\n", input);
  console.time("Time");
  const proof = await utils.snarkProof(input);
  console.log("Proof:\n", proof);
  console.timeEnd("Time");

  const verify = await utils.snarkVerify(proof);
  assert(verify);

  // try to cheat with recipient
  proof.publicSignals[2] = '0x000000000000000000000000000000000000000000000000000000000000beef';
  const verifyScam = await utils.snarkVerify(proof);
  assert(!verifyScam);

  console.log("Done.");
})();
