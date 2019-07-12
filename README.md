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



