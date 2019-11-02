include "../node_modules/circomlib/circuits/mimcsponge.circom";

// Computes MiMC(left + right)
template HashLeftRight() {
    signal input left;
    signal input right;

    signal output hash;

    component hasher = MiMCSponge(2, 220, 1);
    hasher.ins[0] <== left;
    hasher.ins[1] <== right;
    hasher.k <== 0;

    hash <== hasher.outs[0];
}

// if pathIndex == 0 returns (left = inputElement, right = pathElement)
// if pathIndex == 1 returns (left = pathElement, right = inputElement)
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

// Verifies that merkle proof is correct for given merkle root and a leaf
// pathIndex input is an array of 0/1 selectors telling whether given pathElement is on the left or right side of merkle path
template MerkleTree(levels) {
    signal input leaf;
    signal input root;
    signal private input pathElements[levels];
    signal private input pathIndex[levels];

    component selectors[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        selectors[i] = Selector();
        hashers[i] = HashLeftRight();

        selectors[i].pathElement <== pathElements[i];
        selectors[i].pathIndex <== pathIndex[i];

        hashers[i].left <== selectors[i].left;
        hashers[i].right <== selectors[i].right;
    }

    selectors[0].inputElement <== leaf;

    for (var i = 1; i < levels; i++) {
        selectors[i].inputElement <== hashers[i-1].hash;
    }

    root === hashers[levels - 1].hash;
}
