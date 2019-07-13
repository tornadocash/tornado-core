#!/usr/bin/env node
const snarkjs = require("snarkjs");
const bigInt = snarkjs.bigInt;
const utils = require("./scripts/utils");
const merkleTree = require('./lib/MerkleTree');
const contract = require("truffle-contract");
const Mixer = contract(require('./build/contracts/Mixer.json'));

const sender = "";//accounts[0];
const amount = "1 ether";

async function deposit() {
  let deposit = {
    nullifier: utils.rbigint(31),
    secret: utils.rbigint(31),
  };
  const preimage = Buffer.concat([deposit.nullifier.leInt2Buff(32), deposit.secret.leInt2Buff(32)]);
  deposit.commitment = utils.pedersenHash(preimage);

  console.log("Submitting deposit transaction");
  const mixer = await Mixer.deployed();
  await mixer.deposit(deposit.commitment, { value: amount, from: sender });

  return preimage.toString('hex');
}

async function withdraw(note, receiver) {
  let buf = Buffer.from(note.slice(2), "hex");
  let deposit = {
    nullifier: bigInt.leBuff2int(buf.slice(0, 32)),
    secret: bigInt.leBuff2int(buf.slice(32, 64)),
  };

  console.log("Getting current state from mixer contract");
  const mixer = await Mixer.deployed();

  const {root, path_elements, path_index} = await tree.path(1);
  // Circuit input
  const input = {
    // public
    root: root,
    nullifier: deposit.nullifier,
    receiver: bigInt(receiver),
    fee: bigInt(0),

    // private
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndex: path_index,
  };

  console.log("Generating SNARK proof");
  const { pi_a, pi_b, pi_c, publicSignals } = await utils.snarkProof(input);

  console.log("Submitting withdraw transaction");
  await mixer.withdraw(pi_a, pi_b, pi_c, publicSignals, { from: sender })
}

function printHelp() {
  console.log(`
Usage:
  Submit a deposit from default eth account and return the resulting note 
  $ ./cli.js deposit
  
  Withdraw a note to 'receiver' account
  $ ./cli.js withdraw <note <receiver
  
Example:
  $ ./cli.js deposit
  ...
  Your note: 0x1941fa999e2b4bfeec3ce53c2440c3bc991b1b84c9bb650ea19f8331baf621001e696487e2a2ee54541fa12f49498d71e24d00b1731a8ccd4f5f5126f3d9f400
  
  $ ./cli.js withdraw 0x1941fa999e2b4bfeec3ce53c2440c3bc991b1b84c9bb650ea19f8331baf621001e696487e2a2ee54541fa12f49498d71e24d00b1731a8ccd4f5f5126f3d9f400 0xee6249BA80596A4890D1BD84dbf5E4322eA4E7f0
`);
  process.exit(0);
}

(async () => {
  const dep = await deposit();
  console.log(`Your note: 0x${dep}`);

  const acc = "0xee6249BA80596A4890D1BD84dbf5E4322eA4E7f0";//accounts[1];
  await withdraw(dep, acc);
})();


// const args = process.argv.slice(2);
// if (args.length === 0) {
//   printHelp();
// }
//
// switch (args[0]) {
//   case 'deposit':
//     if (args.length === 1)
//       deposit().then(() => process.exit(0));
//     else
//       printHelp();
//     break;
//
//   case 'withdraw':
//     if (args.length === 3 && /^[0-9a-fA-F]{128}$/.test(args[1]) && /^[0-9a-fA-F]{64}$/.test(args[2]))
//       withdraw(args[1], args[2]).then(() => process.exit(0));
//     else
//       printHelp();
//     break;
//
//   default:
//     printHelp();
// }
