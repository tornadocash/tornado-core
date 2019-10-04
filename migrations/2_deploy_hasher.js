/* global artifacts */
const path = require('path')

const genContract = require('circomlib/src/mimcsponge_gencontract.js')
const Artifactor = require('truffle-artifactor')

const SEED = 'mimcsponge'


module.exports = function(deployer) {
  return deployer.then( async () =>  {
    const contractsDir = path.join(__dirname, '..', 'build/contracts')
    let artifactor = new Artifactor(contractsDir)
    let contractName = 'Hasher'
    await artifactor.save({
      contractName,
      abi: genContract.abi,
      unlinked_binary: genContract.createCode(SEED, 220),
    }).then(async () => {
      const hasherContract = artifacts.require(contractName)
      await deployer.deploy(hasherContract)
    })
  })
}
