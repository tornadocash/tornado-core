# Tornado mixer [![Build Status](https://travis-ci.org/peppersec/tornado-mixer.svg?branch=master)](https://travis-ci.org/peppersec/tornado-mixer)

Tornado is a non-custodial Ethereum and ERC20 mixer based on zkSNARKs. It improves transaction privacy by breaking the on-chain link between recipient and destination addresses. It uses a smart contract that accepts ETH deposits that can be withdrawn by a different address. Whenever ETH is withdrawn by the new address, there is no way to link the withdrawal to the deposit, ensuring complete privacy.

To make a deposit user generates a secret and sends its hash (called a commitment) along with deposit amount to the Tornado smart contract. The contract accepts the deposit and adds the commitment to its list of deposits.

Later, the user decides to make a withdraw. In order to do that the user should provide a proof that he or she possesses a secret to an unspent commitment from the smart contract’s list of deposits. zkSnark technology allows to do that without revealing which exact deposit corresponds to this secret. The smart contract will check the proof, and transfer deposited funds to the address specified for withdrawal. An external observer will be unable to determine which deposit this withdrawal comes from.

You can read more about it in [this medium article](https://medium.com/@tornado.cash.mixer/introducing-private-transactions-on-ethereum-now-42ee915babe0)

## Specs
- Deposit gas const: 888054 (43381 + 50859 * tree_depth)
- Withdraw gas cost: 692133
- Circuit Constraints = 22617 (1869 + 1325 * tree_depth)
- Circuit Proof time = 6116ms (1071 + 347 * tree_depth)
- Serverless

![mixer image](./mixer.png)

## Security risks
* Cryptographic tools used by mixer (zkSNARKS, Pedersen commitment, MiMC hash) are not yet extensively audited by cryptographic experts and may be vulnerable
	* Note: we use MiMC hash only for merkle tree, so even if a preimage attack on MiMC is discovered, it will not allow to deanonymize users. To drain funds attacker needs to be able to generate arbitrary hash collisions, which is a pretty strong assumption.
* Bugs in contract. Even though we have an extensive experience in smart contract security audits, we can still make mistakes. An external audit is needed to reduce probablility of bugs. Our mixer is currently being audited, stay tuned.
* Relayer is frontrunnable. When relayer submits a transaction someone can see it in tx pool and frontrun it with higher gas price to get the fee and drain relayer funds.
	* Workaround: we can set high gas price so that (almost) all fee is used on gas
	* Second workaround: allow only single hardcoded relayer, we use this approach for now
* ~~Nullifier griefing. when you submit a withdraw transaction you reveal the nullifier for your note. If someone manages to
make a deposit with the same nullifier and withdraw it while your transaction is still in tx pool, your note will be considered
spent since it has the same nullifier and it will prevent you from withdrawing your funds~~
  * Fixed by sending nullifier hash instead of plain nullifier

## Requirements
1. `node v11.15.0`
2. `npm install -g npx`

## Usage

You can see example usage in cli.js, it works both in console and in browser.

1. `npm install`
1. `cp .env.example .env`
1. `npm run build:circuit` - this may take 10 minutes or more
1. `npm run build:contract`
1. `npm run browserify`
1. `npx ganache-cli`
1. `npm run test` - optionally run tests. It may fail for the first time, just run one more time.

Use browser version on Kovan:

1. `vi .env` - add your Kovan private key to deploy contracts
1. `npm run migrate`
1. `npx http-server` - serve current dir, you can use any other static http server
1. Open `localhost:8080`

Use with command line version with Ganache:
### ETHMixer
1. `npm run migrate:dev`
1. `./cli.js deposit`
1. `./cli.js withdraw <note from previous step> <destination eth address>`
1. `./cli.js balance <destination eth address>`

### ERC20Mixer
1. `npm run migrate:dev`
1. `./cli.js depositErc20`
1. `./cli.js withdraw <note from previous step> <destination eth address> <relayer eth address>`
1. `./cli.js balanceErc20 <destination eth address> <relayer eth address>`

If you want, you can point the app to existing tornado contracts on Mainnet or Kovan, it should work without any changes

## Deploy ETH Tornado Cash
1. `cp .env.example .env`
1. Tune all necessary params
1. `npx truffle migrate --network kovan --reset --f 2 --to 4`

## Deploy ERC20 Tornado Cash
1. `cp .env.example .env`
1. Tune all necessary params
1. `npx truffle migrate --network kovan --reset --f 2 --to 3`
1. `npx truffle migrate --network kovan --reset --f 5`

**Note**. If you want to reuse the same verifier for all the mixers, then after you deployed one of the mixers you should only run 4th or 5th migration for ETH or ERC20 mixers respectively (`--f 4 --to 4` or `--f 5`).

## Credits

Special thanks to @barryWhiteHat and @kobigurk for valuable input,
and to @jbaylina for awesome [Circom](https://github.com/iden3/circom) & [Websnark](https://github.com/iden3/websnark) framework
