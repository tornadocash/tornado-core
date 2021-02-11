const eth = true
const poolSize = '1000000000000000000'
const hasherAddress = '0x83584f83f26aF4eDDA9CBe8C730bc87C364b28fe'
const verifierAddress = '0xce172ce1F20EC0B3728c9965470eaf994A03557A'
const deployerAddress = '0xCEe71753C9820f063b38FDbE4cFDAf1d3D928A80'
const deploySalt = '0x0000000000000000000000000000000000000000000000000000000047941987'
const rpcUrl = 'https://mainnet.infura.io'

const Web3 = require('web3')
const web3 = new Web3(rpcUrl)

const contractData = require('./build/contracts/' + (eth ? 'ETHTornado.json' : 'ERC20Tornado.json'))
const contract = new web3.eth.Contract(contractData.abi)
const bytes = contract
  .deploy({
    data: contractData.bytecode,
    arguments: [verifierAddress, hasherAddress, poolSize, 20],
  })
  .encodeABI()

console.log('Deploy bytecode', bytes)

const deployer = new web3.eth.Contract(require('./build/contracts/IDeployer.json').abi, deployerAddress)
const receipt = deployer.methods.deploy(bytes, deploySalt)
receipt.then(console.log).catch(console.log)
