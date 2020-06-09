/* global artifacts */
const Hasher = artifacts.require('Hasher')

module.exports = async function(deployer) {
  await deployer.deploy(Hasher)
}
