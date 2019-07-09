include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/mimcsponge.circom";

template HashLeftRight(rounds) {
    signal input left;
    signal input right;

    signal output hash;

    component hasher = MiMCSponge(2, rounds, 1);
    hasher.ins[0] <== left;
    hasher.ins[1] <== right;
    hasher.k <== 0;

    hash <== hasher.outs[0];
}

template Selector() {
    signal input inputElement;
    signal input pathElement;
    signal input pathIndex;

    signal output left;
    signal output right;

    signal leftSelector1;
    signal leftSelector2;
    signal rightSelector1;
    signal rightSelector2;

    pathIndex * (1-pathIndex) === 0

    leftSelector1 <== (1 - pathIndex) * inputElement;
    leftSelector2 <== (pathIndex) * pathElement;
    rightSelector1 <== (pathIndex) * inputElement;
    rightSelector2 <== (1 - pathIndex) * pathElement;

    left <== leftSelector1 + leftSelector2;
    right <== rightSelector1 + rightSelector2;
}

template MerkleTree(levels, rounds) {
    signal input leaf;
    signal private input pathElements[levels];
    signal private input pathIndex[levels];

    signal output root;

    component selectors[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        selectors[i] = Selector();
        hashers[i] = HashLeftRight(rounds);

        selectors[i].pathElement <== pathElements[i];
        selectors[i].pathIndex <== pathIndex[i];

        hashers[i].left <== selectors[i].left;
        hashers[i].right <== selectors[i].right;
    }

    selectors[0].inputElement <== leaf;

    for (var i = 1; i < levels; i++) {
        selectors[i].inputElement <== hashers[i-1].hash;
    }

    root <== hashers[levels - 1].hash;
}