/* global artifacts */
const FeeManager = artifacts.require('FeeManager')

module.exports = function (deployer, network, accounts) {
  deployer.deploy(FeeManager, accounts[0])
}
