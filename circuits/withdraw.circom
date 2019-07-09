include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/pedersen.circom";
include "merkleTree.circom";

template CommitmentHasher() {
    signal input nullifier;
    signal private input secret;

    signal output hash;

    component commitment = Pedersen(512);
    component nullifierBits = Num2Bits(256);
    component secretBits = Num2Bits(256);
    nullifierBits.in <== nullifier;
    secretBits.in <== secret;
    for (var i = 0; i < 256; i++) {
        commitment.in[i] <== nullifierBits.out[i];
        commitment.in[i + 256] <== secretBits.out[i];
    }

    hash <== commitment.out[0];
}

template Withdraw(levels, rounds) {
    signal input root;
    signal input nullifier;
    signal input receiver; // not taking part in any computations
    signal input fee; // not taking part in any computations
    signal private input secret;
    signal private input pathElements[levels];
    signal private input pathIndex[levels];

    component hasher = CommitmentHasher();
    hasher.nullifier <== nullifier;
    hasher.secret <== secret;

    component tree = MerkleTree(levels, rounds);
    tree.leaf <== hasher.hash;
    tree.pathElements <== pathElements;
    tree.pathIndex <== pathIndex;

    root === tree.root;

    // TODO: Check if we need some kind of explicit constraints or something
    fee === fee;
    receiver === receiver;
}

component main = Withdraw(16, 220);