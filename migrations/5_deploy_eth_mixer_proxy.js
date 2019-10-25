/* global artifacts */
require('dotenv').config({ path: '../.env' })
const ETHMixer = artifacts.require('ETHMixer')
const gsnProxy = artifacts.require('GSNProxy')

module.exports = function(deployer) {
  return deployer.then(async () => {
    let mixer = await ETHMixer.deployed()
    const proxy = await deployer.deploy(
      gsnProxy,
      mixer.address,
      '0x0000000000000000000000000000000000000000',
    )
    console.log('Mixer\'s proxy address ', proxy.address)
  })
}
