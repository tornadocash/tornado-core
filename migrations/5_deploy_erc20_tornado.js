/* global artifacts */
require('dotenv').config({path: '../.env'})
const ERC20Tornado = artifacts.require('ERC20Tornado')
const hasherContract = artifacts.require('Hasher')
const ERC20Mock = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const {
  MERKLE_TREE_HEIGHT,
  ERC20_TOKEN,
  TOKEN_AMOUNT,
  VERIFIER,
  FEE_MANAGER,
} = process.env

module.exports = function (deployer, network, accounts) {
  return deployer.then(async () => {
    const hasherInstance = await hasherContract.deployed()
    await ERC20Tornado.link(hasherContract, hasherInstance.address)
    let token = ERC20_TOKEN
    if (token === '' || network === 'development') {
      const tokenInstance = await deployer.deploy(ERC20Mock)
      token = tokenInstance.address
    }
    console.log(`Deploying ERC20Tornado with token ${ERC20_TOKEN} and denomination ${TOKEN_AMOUNT}`)
    const tornado = await deployer.deploy(
      ERC20Tornado,
      VERIFIER,
      FEE_MANAGER,
      TOKEN_AMOUNT,
      MERKLE_TREE_HEIGHT,
      ZERO_ADDRESS,
      token,
    )
    console.log('ERC20Tornado\'s address ', tornado.address)
  })
}
