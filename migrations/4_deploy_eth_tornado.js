/* global artifacts */
require('dotenv').config({ path: '../.env' })
const ETHTornado = artifacts.require('ETHTornado')
const Verifier = artifacts.require('Verifier')
const hasherContract = artifacts.require('Hasher')


module.exports = function(deployer, network, accounts) {
  return deployer.then(async () => {
    const { MERKLE_TREE_HEIGHT, ETH_AMOUNT } = process.env
    const verifier = await Verifier.deployed()
    const hasherInstance = await hasherContract.deployed()
    await ETHTornado.link(hasherContract, hasherInstance.address)
    const tornado = await deployer.deploy(ETHTornado, verifier.address, ETH_AMOUNT, MERKLE_TREE_HEIGHT, accounts[0])
    console.log('ETHTornado\'s address ', tornado.address)
  })
}
