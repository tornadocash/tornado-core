/* global artifacts */
require('dotenv').config()
const Verifier = artifacts.require('Verifier')

module.exports = function(deployer) {
  deployer.deploy(Verifier)
}
