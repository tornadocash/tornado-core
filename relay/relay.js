const bigInt = require('snarkjs/src/bigint')
const utils = require('../scripts/utils')

const express = require('express')
const app = express()
app.use(express.json())

// todo get from config
const RPC_ENDPOINT = 'http://localhost:8545'
const NET_ID = 42
// const PRIVATE_KEY = ''

const Web3 = require('web3')
const web3 = new Web3(RPC_ENDPOINT, null, { transactionConfirmationBlocks: 1 })
const contractJson = require('../build/contracts/Mixer.json')
const mixer = new web3.eth.Contract(contractJson.abi, contractJson.networks[NET_ID].address)

function getMinimumFee() {
  // todo calc acceptable fee
  return bigInt(1e16)
}

app.post('/deposit', async (req, resp) => {
  let proof = req.body
  if (!(proof.pi_a && proof.pi_b && proof.pi_c && proof.publicSignals)) { // check that it's kinda well formed
    resp.status(400).end()
  }

  if (bigInt(proof.publicSignals[3]) < getMinimumFee()) {
    resp.status(403).send('Fee is too low')
  }

  if (!utils.snarkVerify(proof)) {
    resp.status(403).send('Invalid snark proof')
  }

  try {
    const gas = await mixer.withdraw(proof.pi_a, proof.pi_b, proof.pi_b, proof.publicSignals).estimateGas()
    if (gas > 1e6) {
      // something is wrong
    }
    const result = mixer.withdraw(proof.pi_a, proof.pi_b, proof.pi_b, proof.publicSignals).send()
    result.once('transactionHash', function(hash){
      resp.send({ transaction: hash })
    }).on('error', function(e){
      console.log(e)
      resp.status(400).send('Transaction was reverted')
    })
  } catch (e) {
    console.log(e)
    resp.status(400).send('Transaction was reverted')
  }
})
app.listen(3000)
