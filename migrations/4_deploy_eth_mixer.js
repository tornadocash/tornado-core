/* global artifacts */
require('dotenv').config({ path: '../.env' })
const ETHMixer = artifacts.require('ETHMixer')
const Verifier = artifacts.require('Verifier')
const hasherContract = artifacts.require('hasher')


module.exports = function(deployer, network, accounts) {
  return deployer.then(async () => {
    const { MERKLE_TREE_HEIGHT, ETH_AMOUNT, EMPTY_ELEMENT } = process.env
    const verifier = await Verifier.deployed()
    const hasherInstance = await hasherContract.deployed()
    await ETHMixer.link(hasherContract, hasherInstance.address)
    const mixer = await deployer.deploy(ETHMixer, verifier.address, ETH_AMOUNT, MERKLE_TREE_HEIGHT, EMPTY_ELEMENT, accounts[0])
    console.log('ETHMixer\'s address ', mixer.address)
  })
}
