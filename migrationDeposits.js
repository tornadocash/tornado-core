require('dotenv').config()
const Web3 = require('web3')
const web3 = new Web3('https://mainnet.infura.io', null, { transactionConfirmationBlocks: 1 })
const web3Kovan = new Web3('https://kovan.infura.io', null, { transactionConfirmationBlocks: 1 })
const account = web3.eth.accounts.privateKeyToAccount('0x' + process.env.PRIVATE_KEY)
web3.eth.accounts.wallet.add('0x' + process.env.PRIVATE_KEY)
web3.eth.defaultAccount = account.address
const ABI = [{ 'constant':false,'inputs':[{ 'name':'_newAccount','type':'address' }],'name':'changeOperator','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[],'name':'filled_subtrees','outputs':[{ 'name':'','type':'uint256[]' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[{ 'name':'','type':'uint256' }],'name':'nullifierHashes','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'verifier','outputs':[{ 'name':'','type':'address' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'transferValue','outputs':[{ 'name':'','type':'uint256' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'_commitments','type':'uint256[]' },{ 'name':'_nullifierHashes','type':'uint256[]' }],'name':'migrateState','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[],'name':'roots','outputs':[{ 'name':'','type':'uint256[]' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'_verifier','type':'address' },{ 'name':'_transferValue','type':'uint256' },{ 'name':'_merkleTreeHeight','type':'uint8' },{ 'name':'_emptyElement','type':'uint256' },{ 'name':'_operator','type':'address' },{ 'name':'_filled_subtrees','type':'uint256[]' },{ 'name':'_lastRoot','type':'uint256' }],'name':'initialize','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[{ 'name':'','type':'uint256' }],'name':'commitments','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'zeros','outputs':[{ 'name':'','type':'uint256[]' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'levels','outputs':[{ 'name':'','type':'uint256' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'a','type':'uint256[2]' },{ 'name':'b','type':'uint256[2][2]' },{ 'name':'c','type':'uint256[2]' },{ 'name':'input','type':'uint256[4]' }],'name':'withdraw','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[],'name':'operator','outputs':[{ 'name':'','type':'address' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'isDepositsEnabled','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[{ 'name':'nullifier','type':'uint256' }],'name':'isSpent','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[{ 'name':'left','type':'uint256' },{ 'name':'right','type':'uint256' }],'name':'hashLeftRight','outputs':[{ 'name':'mimc_hash','type':'uint256' }],'payable':false,'stateMutability':'pure','type':'function' },{ 'constant':true,'inputs':[],'name':'next_index','outputs':[{ 'name':'','type':'uint32' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'current_root','outputs':[{ 'name':'','type':'uint256' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'tree_levels','type':'uint256' },{ 'name':'zero_value','type':'uint256' },{ 'name':'filled_subtrees','type':'uint256[]' },{ 'name':'lastRoot','type':'uint256' }],'name':'initialize','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[{ 'name':'root','type':'uint256' }],'name':'isKnownRoot','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'commitment','type':'uint256' }],'name':'deposit','outputs':[],'payable':true,'stateMutability':'payable','type':'function' },{ 'constant':true,'inputs':[],'name':'getLastRoot','outputs':[{ 'name':'','type':'uint256' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[],'name':'toggleDeposits','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':false,'inputs':[],'name':'stopMigration','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[],'name':'isMigrating','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'payable':true,'stateMutability':'payable','type':'fallback' },{ 'anonymous':false,'inputs':[{ 'indexed':true,'name':'commitment','type':'uint256' },{ 'indexed':false,'name':'leafIndex','type':'uint256' },{ 'indexed':false,'name':'timestamp','type':'uint256' }],'name':'Deposit','type':'event' },{ 'anonymous':false,'inputs':[{ 'indexed':false,'name':'to','type':'address' },{ 'indexed':false,'name':'nullifierHash','type':'uint256' },{ 'indexed':false,'name':'fee','type':'uint256' }],'name':'Withdraw','type':'event' }]
const ABIv2 = require('./build/contracts/ETHMixer.json').abi
const snarkjs = require('snarkjs')
const bigInt = snarkjs.bigInt

const { numberToHex, toWei } = require('web3-utils')
const PREVIOUS_MIXER = '0xb541fc07bC7619fD4062A54d96268525cBC6FfEF'

function toHex(number, length = 32) {
  let str = number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)
  return '0x' + str.padStart(length * 2, '0')
}
const previousMixer = new web3.eth.Contract(ABI, PREVIOUS_MIXER)
previousMixer.deployedBlock = 8720524

async function loadDeposits() {
  const depositEvents = await previousMixer.getPastEvents('Deposit', { fromBlock: previousMixer.deployedBlock, toBlock: 'latest' })

  const withdrawEvents = await previousMixer.getPastEvents('Withdraw', { fromBlock: previousMixer.deployedBlock, toBlock: 'latest' })

  const commitments = depositEvents
    .sort((a, b) => a.returnValues.leafIndex.sub(b.returnValues.leafIndex))
    .map(e => toHex(e.returnValues.commitment))
  const nullifiers = withdrawEvents
    .map(e => toHex(e.returnValues.nullifierHash))
  const subtrees = (await previousMixer.methods.filled_subtrees().call()).map(x => toHex(x))
  const lastRoot = await previousMixer.methods.getLastRoot().call()
  // console.log(JSON.stringify({ subtrees, lastRoot, commitments, nullifiers }, null, 2))
  return { subtrees, lastRoot: toHex(lastRoot), commitments, nullifiers }
}

async function migrateState({ subtrees, lastRoot, commitments, nullifiers, newMixer }) {
  const loadBy = 100
  let commitmentsToLoad
  let nullifiersToLoad
  await newMixer.methods.initializeTreeForMigration(subtrees, lastRoot).send({
    gas: numberToHex(2500000),
    gasPrice: toHex(toWei('10', 'gwei')),
    from: account.address
  })
  for(let i=0; i < commitments.length / loadBy; i++) {
    commitmentsToLoad = commitments.slice(i*loadBy, (i+1)*loadBy)
    nullifiersToLoad = nullifiers.slice(i*loadBy, (i+1)*loadBy)
    console.log(`Uploading commitments and nullifiers from ${i*loadBy} to ${(i+1)*loadBy}:`)
    // console.log('Commitments:\n', commitmentsToLoad)
    // console.log('Nullifiers:\n', nullifiersToLoad)

    const tx = await newMixer.methods.migrateState(
      commitmentsToLoad,
      nullifiersToLoad
    ).send({
      gas: numberToHex(6500000),
      gasPrice: toHex(toWei('10', 'gwei')),
      from: account.address
    })
    console.log('Gas used:', tx.gasUsed)
  }
}
async function main() {
  const { subtrees, lastRoot, commitments, nullifiers } = await loadDeposits()

  const newContractAddress = '0xE89f4Ca5242C28D3D9565cd12499C1A53A9B76AD'
  const newMixer = new web3Kovan.eth.Contract(ABIv2, newContractAddress)
  web3Kovan.eth.accounts.wallet.add('0x' + process.env.PRIVATE_KEY)
  web3Kovan.eth.defaultAccount = account.address
  await migrateState({ subtrees, lastRoot, commitments, nullifiers, newMixer })

}
main()
