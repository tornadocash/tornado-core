/* global artifacts */
const path = require('path')

const mimcGenContract = require('circomlib/src/mimcsponge_gencontract.js')
const Artifactor = require('truffle-artifactor')

const SEED = 'mimcsponge'


module.exports = function(deployer) {
  return deployer.then( async () =>  {
    const contractsDir = path.join(__dirname, '..', 'build/contracts')
    let artifactor = new Artifactor(contractsDir)
    let mimcContractName = 'MiMC'
    await artifactor.save({
      contractName: mimcContractName,
      abi: mimcGenContract.abi,
      unlinked_binary: mimcGenContract.createCode(SEED, 220),
    }).then(async () => {
      const MiMC = artifacts.require(mimcContractName)
      await deployer.deploy(MiMC)
    })
  })
}
