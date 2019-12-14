require('dotenv').config()
const Web3 = require('web3')

// 1. edit here
const SOURCE_RPC = 'https://mainnet.infura.io/v3/c7463beadf2144e68646ff049917b716'
const TARGET_RPC = 'https://kovan.poa.network'
const HELPER_RPC = 'https://kovan.poa.network'
const web3Source = new Web3(SOURCE_RPC, null, { transactionConfirmationBlocks: 1 })
const web3Target = new Web3(TARGET_RPC, null, { transactionConfirmationBlocks: 1 })
const web3Helper = new Web3(HELPER_RPC, null, { transactionConfirmationBlocks: 1 })

const ABI = [{ 'constant':false,'inputs':[{ 'name':'_newAccount','type':'address' }],'name':'changeOperator','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[],'name':'filled_subtrees','outputs':[{ 'name':'','type':'uint256[]' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[{ 'name':'','type':'uint256' }],'name':'nullifierHashes','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'verifier','outputs':[{ 'name':'','type':'address' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'transferValue','outputs':[{ 'name':'','type':'uint256' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'_commitments','type':'uint256[]' },{ 'name':'_nullifierHashes','type':'uint256[]' }],'name':'migrateState','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[],'name':'roots','outputs':[{ 'name':'','type':'uint256[]' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'_verifier','type':'address' },{ 'name':'_transferValue','type':'uint256' },{ 'name':'_merkleTreeHeight','type':'uint8' },{ 'name':'_emptyElement','type':'uint256' },{ 'name':'_operator','type':'address' },{ 'name':'_filled_subtrees','type':'uint256[]' },{ 'name':'_lastRoot','type':'uint256' }],'name':'initialize','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[{ 'name':'','type':'uint256' }],'name':'commitments','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'zeros','outputs':[{ 'name':'','type':'uint256[]' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'levels','outputs':[{ 'name':'','type':'uint256' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'a','type':'uint256[2]' },{ 'name':'b','type':'uint256[2][2]' },{ 'name':'c','type':'uint256[2]' },{ 'name':'input','type':'uint256[4]' }],'name':'withdraw','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[],'name':'operator','outputs':[{ 'name':'','type':'address' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'isDepositsEnabled','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[{ 'name':'nullifier','type':'uint256' }],'name':'isSpent','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[{ 'name':'left','type':'uint256' },{ 'name':'right','type':'uint256' }],'name':'hashLeftRight','outputs':[{ 'name':'mimc_hash','type':'uint256' }],'payable':false,'stateMutability':'pure','type':'function' },{ 'constant':true,'inputs':[],'name':'next_index','outputs':[{ 'name':'','type':'uint32' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':true,'inputs':[],'name':'current_root','outputs':[{ 'name':'','type':'uint256' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'tree_levels','type':'uint256' },{ 'name':'zero_value','type':'uint256' },{ 'name':'filled_subtrees','type':'uint256[]' },{ 'name':'lastRoot','type':'uint256' }],'name':'initialize','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[{ 'name':'root','type':'uint256' }],'name':'isKnownRoot','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[{ 'name':'commitment','type':'uint256' }],'name':'deposit','outputs':[],'payable':true,'stateMutability':'payable','type':'function' },{ 'constant':true,'inputs':[],'name':'getLastRoot','outputs':[{ 'name':'','type':'uint256' }],'payable':false,'stateMutability':'view','type':'function' },{ 'constant':false,'inputs':[],'name':'toggleDeposits','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':false,'inputs':[],'name':'stopMigration','outputs':[],'payable':false,'stateMutability':'nonpayable','type':'function' },{ 'constant':true,'inputs':[],'name':'isMigrating','outputs':[{ 'name':'','type':'bool' }],'payable':false,'stateMutability':'view','type':'function' },{ 'payable':true,'stateMutability':'payable','type':'fallback' },{ 'anonymous':false,'inputs':[{ 'indexed':true,'name':'commitment','type':'uint256' },{ 'indexed':false,'name':'leafIndex','type':'uint256' },{ 'indexed':false,'name':'timestamp','type':'uint256' }],'name':'Deposit','type':'event' },{ 'anonymous':false,'inputs':[{ 'indexed':false,'name':'to','type':'address' },{ 'indexed':false,'name':'nullifierHash','type':'uint256' },{ 'indexed':false,'name':'fee','type':'uint256' }],'name':'Withdraw','type':'event' }]
const ABIv2 = require('./build/contracts/MigratableETHTornado.json').abi
const snarkjs = require('snarkjs')
const bigInt = snarkjs.bigInt
const { numberToHex, toWei } = require('web3-utils')

// 2. edit here
const PREVIOUS_INSTANCE = '0xb541fc07bC7619fD4062A54d96268525cBC6FfEF'
const HELPER_INSTANCE = '0x831822ad4A8AEbfC27DF0b915902de855E613eb2'
const NEW_INSTANCE = '0xcdA7FC8a05CFF618f7e323c547d6F2EF6c3578AA'

function toHex(number, length = 32) {
  let str = number instanceof Buffer ? number.toString('hex') : bigInt(number).toString(16)
  return '0x' + str.padStart(length * 2, '0')
}
const previousInstance = new web3Source.eth.Contract(ABI, PREVIOUS_INSTANCE)
previousInstance.deployedBlock = 0

async function loadDeposits() {
  const depositEvents = await previousInstance.getPastEvents('Deposit', { fromBlock: previousInstance.deployedBlock, toBlock: 'latest' })
  console.log('deposits length', depositEvents.length)
  const withdrawEvents = await previousInstance.getPastEvents('Withdraw', { fromBlock: previousInstance.deployedBlock, toBlock: 'latest' })
  console.log('withdrawEvents length', withdrawEvents.length)
  const commitments = depositEvents
    .sort((a, b) => a.returnValues.leafIndex.sub(b.returnValues.leafIndex))
    .map(e => toHex(e.returnValues.commitment))
  const nullifiers = withdrawEvents
    .map(e => toHex(e.returnValues.nullifierHash))

  const { root, subtrees } = await getSubtrees({ commitments })
  console.log(root, subtrees)

  // console.log(JSON.stringify({ subtrees, lastRoot, commitments, nullifiers }, null, 2))
  return { subtrees, lastRoot: toHex(root), commitments, nullifiers }
}

async function makeDeposit({ web3, privKey, instance, nonce, commitment }) {
  const data = instance.methods.deposit(commitment).encodeABI()
  const tx = {
    from: web3Helper.eth.defaultAccount,
    value: toWei('0.1'),
    gas: 2e6,
    gasPrice: toHex(toWei('2', 'gwei')),
    to: instance._address,
    netId: await web3.eth.net.getId(),
    data,
    nonce
  }
  let signedTx = await web3.eth.accounts.signTransaction(tx, privKey)
  return web3.eth.sendSignedTransaction(signedTx.rawTransaction)
}

async function getSubtrees({ commitments }) {
  const tempInstance = new web3Helper.eth.Contract(ABIv2, HELPER_INSTANCE)

  let nonce = await web3Helper.eth.getTransactionCount(web3Helper.eth.defaultAccount)
  const chunkSize = 80
  let chunks = Math.ceil(commitments.length / chunkSize)
  for(let c = 0; c < chunks; c++) {
    let lastTransaction
    for(let i = c * chunkSize; i < Math.min(commitments.length, (c + 1) * chunkSize); i++) {
      const n = toHex(nonce)
      lastTransaction = makeDeposit({ web3: web3Helper, privKey: process.env.PRIVATE_KEY, instance: tempInstance, nonce: n, commitment: commitments[i] })
      nonce = bigInt(nonce).add(bigInt('1'))
    }
    console.log(`Waiting for the ${c}th chunk`)
    await lastTransaction
  }

  let subtrees = []
  for (let i = 0; i < process.env.MERKLE_TREE_HEIGHT; i++) {
    subtrees.push(await tempInstance.methods.filledSubtrees(i).call())
  }
  subtrees = subtrees.map(x => toHex(x))
  const lastRoot = await tempInstance.methods.getLastRoot().call()
  return { subtrees, root: toHex(lastRoot) }
}

async function migrateState({ subtrees, lastRoot, commitments, nullifiers, newInstance }) {
  const loadBy = 100
  let commitmentsToLoad
  let nullifiersToLoad
  await newInstance.methods.initializeTreeForMigration(subtrees, lastRoot).send({
    gas: numberToHex(2500000),
    gasPrice: toHex(toWei('10', 'gwei')),
    from: web3Target.eth.defaultAccount
  })
  for(let i=0; i < commitments.length / loadBy; i++) {
    commitmentsToLoad = commitments.slice(i*loadBy, (i+1)*loadBy)
    nullifiersToLoad = nullifiers.slice(i*loadBy, (i+1)*loadBy)
    console.log(`Uploading commitments and nullifiers from ${i*loadBy} to ${(i+1)*loadBy}:`)
    // console.log('Commitments:\n', commitmentsToLoad)
    // console.log('Nullifiers:\n', nullifiersToLoad)

    const tx = await newInstance.methods.migrateState(
      commitmentsToLoad,
      nullifiersToLoad
    ).send({
      gas: numberToHex(6500000),
      gasPrice: toHex(toWei('10', 'gwei')),
      from: web3Target.eth.defaultAccount
    })
    console.log('Gas used:', tx.gasUsed)
  }
  const balance = await web3Source.eth.getBalance(PREVIOUS_INSTANCE)
  console.log('balance to send in wei', balance)

  // 3. Decide should we uncomment here
  // const finish = await newInstance.methods.finishMigration().send({
  //   gas: numberToHex(1500000),
  //   gasPrice: toHex(toWei('10', 'gwei')),
  //   from: web3Target.eth.defaultAccount,
  //   value: balance
  // })
  // console.log('migration completed', finish.transactionHash)
}
async function main() {
  const helperAccount = web3Helper.eth.accounts.privateKeyToAccount('0x' + process.env.PRIVATE_KEY)
  web3Helper.eth.accounts.wallet.add('0x' + process.env.PRIVATE_KEY)
  web3Helper.eth.defaultAccount = helperAccount.address

  const targetAccount = web3Target.eth.accounts.privateKeyToAccount('0x' + process.env.PRIVATE_KEY)
  web3Target.eth.accounts.wallet.add('0x' + process.env.PRIVATE_KEY)
  web3Target.eth.defaultAccount = targetAccount.address

  const { subtrees, lastRoot, commitments, nullifiers } = await loadDeposits()
  const newInstance = new web3Target.eth.Contract(ABIv2, NEW_INSTANCE)

  console.log('commitments length ', commitments.length)
  console.log('nullifiers length ', nullifiers.length)
  await migrateState({ subtrees, lastRoot, commitments, nullifiers, newInstance })

}
main()
