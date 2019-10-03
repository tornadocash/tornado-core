/* global artifacts */
require('dotenv').config({ path: '../.env' })
const ERC20Mixer = artifacts.require('ERC20Mixer')
const Verifier = artifacts.require('Verifier')
const MiMC = artifacts.require('MiMC')
const ERC20Mock = artifacts.require('ERC20Mock')
const UniswapMock = artifacts.require('UniswapMock')
const { toBN, toWei } = require('web3-utils')
const eth2daiPrice = toBN('174552286079977583324') // cause 1 ETH == 174.55 DAI


module.exports = function(deployer, network, accounts) {
  return deployer.then(async () => {
    const { MERKLE_TREE_HEIGHT, ETH_AMOUNT, EMPTY_ELEMENT, ERC20_TOKEN, TOKEN_AMOUNT } = process.env
    const verifier = await Verifier.deployed()
    const miMC = await MiMC.deployed()
    await ERC20Mixer.link(MiMC, miMC.address)
    let tokenAddress = ERC20_TOKEN
    let uniswapAddress
    if (network === 'development') {
      if(tokenAddress === '') { // means we want to test with mock
        const tokenInstance = await deployer.deploy(ERC20Mock)
        tokenAddress = tokenInstance.address
      }
      const uniswap = await deployer.deploy(UniswapMock, tokenAddress, eth2daiPrice, { value: toWei('0.5') })
      uniswapAddress = uniswap.address
    }
    const mixer = await deployer.deploy(
      ERC20Mixer,
      verifier.address,
      ETH_AMOUNT,
      MERKLE_TREE_HEIGHT,
      EMPTY_ELEMENT,
      accounts[0],
      tokenAddress,
      TOKEN_AMOUNT,
      uniswapAddress
    )
    console.log('ERC20Mixer\'s address ', mixer.address)
  })
}
