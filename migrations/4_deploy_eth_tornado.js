/* global artifacts */
require('dotenv').config({ path: '../.env' })
const ETHTornado = artifacts.require('ETHTornado')
const Verifier = artifacts.require('Verifier')
const Hasher = artifacts.require('Hasher')

module.exports = function (deployer, network, accounts) {
  return deployer.then(async () => {
    const { MERKLE_TREE_HEIGHT, ETH_AMOUNT } = process.env
    const verifier = await Verifier.deployed()
    const hasher = await Hasher.deployed()
    const tornado = await deployer.deploy(
      ETHTornado,
      verifier.address,
      hasher.address,
      ETH_AMOUNT,
      MERKLE_TREE_HEIGHT,
    )
    console.log('ETHTornado address', tornado.address)
  })
}
