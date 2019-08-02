/* global artifacts */
const Migrations = artifacts.require('Migrations')

module.exports = function(deployer) {
  if(deployer.network === 'mainnet') {
    return
  }
  deployer.deploy(Migrations)
}
