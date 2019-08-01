/* global artifacts */
require('dotenv').config({ path: '../.env' })
const Mixer = artifacts.require('Mixer')
const Verifier = artifacts.require('Verifier')
const MiMC = artifacts.require('MiMC')


module.exports = function(deployer, network, accounts) {
  return deployer.then(async () => {
    const { MERKLE_TREE_HEIGHT, AMOUNT, EMPTY_ELEMENT } = process.env
    const verifier = await Verifier.deployed()
    const miMC = await MiMC.deployed()
    await Mixer.link(MiMC, miMC.address)
    const mixer = await deployer.deploy(Mixer, verifier.address, AMOUNT, MERKLE_TREE_HEIGHT, EMPTY_ELEMENT, accounts[0])
    console.log('Mixer\'s address ', mixer.address)
  })
}
