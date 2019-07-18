/* global artifacts */
const Verifier = artifacts.require('Verifier')

module.exports = function(deployer) {
  deployer.deploy(Verifier)
}
