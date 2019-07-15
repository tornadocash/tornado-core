#!/usr/bin/env node
const assert = require('assert');
const snarkjs = require("snarkjs");
const bigInt = snarkjs.bigInt;
const utils = require("./scripts/utils");
const merkleTree = require('./lib/MerkleTree');
const Web3 = require('web3');
require('dotenv').config();
const { MERKLE_TREE_HEIGHT, AMOUNT, EMPTY_ELEMENT } = process.env;

let web3, mixer;

function createDeposit(nullifier, secret) {
  let deposit = {nullifier, secret};
  deposit.preimage = Buffer.concat([deposit.nullifier.leInt2Buff(32), deposit.secret.leInt2Buff(32)]);
  deposit.commitment = utils.pedersenHash(deposit.preimage);
  return deposit;
}

async function deposit() {
  await init();
  const deposit = createDeposit(utils.rbigint(31), utils.rbigint(31));

  console.log("Submitting deposit transaction");
  await mixer.methods.deposit("0x" + deposit.commitment.toString(16)).send({ value: AMOUNT, from: (await web3.eth.getAccounts())[0], gas:1e6 });

  const note = "0x" + deposit.preimage.toString('hex');
  console.log("Your note:", note);
  return note;
}

async function withdraw(note, receiver) {
  await init();
  let buf = Buffer.from(note.slice(2), "hex");
  let deposit = createDeposit(bigInt.leBuff2int(buf.slice(0, 32)), bigInt.leBuff2int(buf.slice(32, 64)));

  console.log("Getting current state from mixer contract");
  const events = await mixer.getPastEvents('LeafAdded', {fromBlock: mixer.deployedBlock, toBlock: 'latest'});
  const leaves = events.sort(e => e.returnValues.leaf_index).map(e => e.returnValues.leaf);
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, EMPTY_ELEMENT, leaves);
  const validRoot = await mixer.methods.isKnownRoot(await tree.root()).call();
  assert(validRoot === true);

  const leafIndex = leaves.map(el => el.toString()).indexOf(deposit.commitment.toString());
  assert(leafIndex >= 0);
  const {root, path_elements, path_index} = await tree.path(leafIndex);
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
  await mixer.methods.withdraw(pi_a, pi_b, pi_c, publicSignals).send({ from: (await web3.eth.getAccounts())[0], gas: 1e6 });
  console.log("Done");
}

async function init() {
  web3 = new Web3('http://localhost:8545', null, {transactionConfirmationBlocks: 1});
  let netId = await web3.eth.net.getId();
  const json = require('./build/contracts/Mixer.json');
  const tx = await web3.eth.getTransaction(json.networks[netId].transactionHash);
  mixer = new web3.eth.Contract(json.abi, json.networks[netId].address);
  mixer.deployedBlock = tx.blockNumber;
}

// ========== CLI related stuff below ==============

function printHelp(code = 0) {
  console.log(`Usage:
  Submit a deposit from default eth account and return the resulting note
  $ ./cli.js deposit

  Withdraw a note to 'receiver' account
  $ ./cli.js withdraw <note> <receiver>

Example:
  $ ./cli.js deposit
  ...
  Your note: 0x1941fa999e2b4bfeec3ce53c2440c3bc991b1b84c9bb650ea19f8331baf621001e696487e2a2ee54541fa12f49498d71e24d00b1731a8ccd4f5f5126f3d9f400

  $ ./cli.js withdraw 0x1941fa999e2b4bfeec3ce53c2440c3bc991b1b84c9bb650ea19f8331baf621001e696487e2a2ee54541fa12f49498d71e24d00b1731a8ccd4f5f5126f3d9f400 0xee6249BA80596A4890D1BD84dbf5E4322eA4E7f0
`);
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  printHelp();
} else {
  switch (args[0]) {
    case 'deposit':
      if (args.length === 1)
        deposit().then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)});
      else
        printHelp(1);
      break;

    case 'withdraw':
      if (args.length === 3 && /^0x[0-9a-fA-F]{128}$/.test(args[1]) && /^0x[0-9a-fA-F]{40}$/.test(args[2]))
        withdraw(args[1], args[2]).then(() => process.exit(0)).catch(err => {console.log(err); process.exit(1)});
      else
        printHelp(1);
      break;

    default:
      printHelp(1);
  }
}
