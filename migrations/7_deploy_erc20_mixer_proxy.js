/* global artifacts */
require('dotenv').config({ path: '../.env' })
const ERC20Mixer = artifacts.require('ERC20Mixer')
const gsnProxy = artifacts.require('GSNProxy')
const ERC20Mock = artifacts.require('ERC20Mock')
const UniswapMock = artifacts.require('UniswapMock')
const { toBN, toWei } = require('web3-utils')
const eth2daiPrice = toBN('174552286079977583324') // cause 1 ETH == 174.55 DAI


module.exports = function(deployer, network) {
  return deployer.then(async () => {
    const { ERC20_TOKEN } = process.env
    let token = ERC20_TOKEN
    let uniswapAddress
    if (network === 'development') { // means we want to test with mock
      if (token === '') {
        const tokenInstance = await ERC20Mock.deployed()
        token = tokenInstance.address
      }
      const uniswap = await deployer.deploy(UniswapMock, token, eth2daiPrice, { value: toWei('0.5') })
      uniswapAddress = uniswap.address
    }
    let mixer = await ERC20Mixer.deployed()
    const proxy = await deployer.deploy(
      gsnProxy,
      mixer.address,
      uniswapAddress,
    )
    console.log('ERC20Mixer\'s proxy address ', proxy.address)
  })
}
