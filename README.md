## Testing
1. `npm i`
2. `npx truffle compile`
3. `npx truffle test` - it may fail for the first time, just run one more time.

Short version:

We have a merkle tree of deposit commitments `Pedersen(secret + nullifier)`, merkle tree uses MiMC
On withdrawal a SNARK proof verifies merkle proof and leaf preimage, .....


