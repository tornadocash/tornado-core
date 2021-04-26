/* global artifacts */
require('dotenv').config({path: '../.env'})
const ERC20Tornado = artifacts.require('ERC20Tornado')
const Verifier = artifacts.require('Verifier')
const FeeManager = artifacts.require('FeeManager')
const hasherContract = artifacts.require('Hasher')
const ERC20Mock = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

module.exports = function (deployer, network, accounts) {
  return deployer.then(async () => {
    const {MERKLE_TREE_HEIGHT, ERC20_TOKEN, TOKEN_AMOUNT} = process.env
    const verifier = await Verifier.deployed()
    const feeManager = await FeeManager.deployed()
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
      verifier.address,
      feeManager.address,
      TOKEN_AMOUNT,
      MERKLE_TREE_HEIGHT,
      accounts[0],
      token,
    )
    console.log('ERC20Tornado\'s address ', tornado.address)
    tornado.changeOwner(ZERO_ADDRESS)
    console.log('Changed ERC20Tornado contract owner to zero address')
  })
}
