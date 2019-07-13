## Testing truffle
1. `npm i`
2. `npm run build:circuit`
2. `npx truffle compile`
3. `npx truffle test` - it may fail for the first time, just run one more time.

## Testing js
1. `npm i`
2. `npm run build:circuit`
3. `cd scripts`
4. `node test_snark.js`

## Deploy
1. `npx truffle migrate --network kovan --reset`

## Requirements
1. `node v11.15.0`
2. `npm install -g npx`

# Specs:
- Deposit gas cost: deposit 903472
- Withdraw gas cost: 727821
- Circuit constraints: 22617
- Circuit proving time: 8965ms
- Serverless, executed entirely in the browser

# Security risks:
* Cryptographic tools used by mixer (zkSNARKS, Pedersen commitment, MiMC hash) are not yet extensively audited by cryptographic experts and may be vulnerable
	* Note: we use MiMC hash only for merkle tree, so even if a preimage attack on MiMC is discovered, it will not allow to deanonymize users or drain mixer funds
* Relayer is frontrunnable. When relayer submits a transaction someone can see it in tx pool and frontrun it with higher gas price to get the fee and drain relayer funds.
	* Workaround: we can set high gas price so that (almost) all fee is used on gas. The relayer will not receive profit this way, but this approach is acceptable until we develop more sophisticated system that prevents frontrunning
* Bugs in contract. Even though we have an extensive experience in smart contract security audits, we can still make mistakes. An external audit is needed to reduce probablility of bugs
* Nullifier griefing. when you submit a withdraw transaction you reveal the nullifier for your note. If someone manages to 
make a deposit with the same nullifier and withdraw it while your transaction is still in tx pool, your note will be considered 
spent since it has the same nullifier and it will prevent you from withdrawing your funds
  * This attack doesnt't provide any profit for the attacker
  * This can be solved by storing block number for merkle root history, and only allowing to withdraw using merkle roots that are older than N ~10-20 blocks.
    It will slightly reduce anonymity set (by not counting users that deposited in last N blocks), but provide a safe period for mining your withdrawal transactions.


