let bigInt = require('snarkjs/src/bigint');

require('dotenv').config();
const { AMOUNT, MERKLE_TREE_HEIGHT, EMPTY_ELEMENT } = process.env;

const express = require('express');
const app = express();
app.use(express.json());

const Web3 = require('web3');
web3 = new Web3('http://localhost:8545', null, {transactionConfirmationBlocks: 1});
contractJson = require('../build/contracts/Mixer.json');
let netId = 42;
mixer = new web3.eth.Contract(contractJson.abi, contractJson.networks[netId].address);

function getMinimumFee() {
  // todo calc acceptable fee
  return 1e16;
}

app.post('/deposit', async (req, resp) => {
  let proof = req.body;
  if (!(proof.pi_a && proof.pi_b && proof.pi_c && proof.publicSignals)) { // check that it's kinda well formed
    resp.status(400).end();
  }

  if (bigInt(proof.publicSignals[3]) < getMinimumFee()) {
    resp.status(403).send("Fee is too low");
  }

  if (!utils.snarkVerify(proof)) {
    resp.status(403).send("Invalid snark proof");
  }

  try {
    let receipt = await mixer.withdraw(proof.pi_a, proof.pi_b, proof.pi_b, proof.publicSignals);
    console.log(receipt);
    resp.send({transaction: receipt.transactionHash})
  } catch (e) {
    console.log(e);
    resp.status(400).send("Transaction was reverted");
  }
});
app.listen(3000);
