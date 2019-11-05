// https://tornado.cash
/*
* d888888P                                           dP              a88888b.                   dP
*    88                                              88             d8'   `88                   88
*    88    .d8888b. 88d888b. 88d888b. .d8888b. .d888b88 .d8888b.    88        .d8888b. .d8888b. 88d888b.
*    88    88'  `88 88'  `88 88'  `88 88'  `88 88'  `88 88'  `88    88        88'  `88 Y8ooooo. 88'  `88
*    88    88.  .88 88       88    88 88.  .88 88.  .88 88.  .88 dP Y8.   .88 88.  .88       88 88    88
*    dP    `88888P' dP       dP    dP `88888P8 `88888P8 `88888P' 88  Y88888P' `88888P8 `88888P' dP    dP
* ooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo
*/

pragma solidity ^0.5.8;

library Hasher {
  function MiMCSponge(uint256 in_xL, uint256 in_xR, uint256 in_k) public pure returns (uint256 xL, uint256 xR);
}

contract MerkleTreeWithHistory {
  uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant ZERO_VALUE = 5702960885942360421128284892092891246826997279710054143430547229469817701242; // = MiMC("tornado")

  uint256 public levels;

  // the following variables are made public for easier testing and debugging and
  // are not supposed to be accessed in regular code
  uint256 public constant ROOT_HISTORY_SIZE = 100;
  uint256[ROOT_HISTORY_SIZE] public roots;
  uint256 public currentRootIndex = 0;
  uint32 public nextIndex = 0;
  uint256[] public filledSubtrees;
  uint256[] public zeros;

  constructor(uint256 _treeLevels) public {
    require(_treeLevels > 0, "_treeLevels should be greater than zero");
    levels = _treeLevels;

    uint256 currentZero = ZERO_VALUE;
    zeros.push(currentZero);
    filledSubtrees.push(currentZero);

    for (uint8 i = 1; i < levels; i++) {
      currentZero = hashLeftRight(currentZero, currentZero);
      zeros.push(currentZero);
      filledSubtrees.push(currentZero);
    }

    roots[0] = hashLeftRight(currentZero, currentZero);
  }

  /**
    @dev Hash 2 tree leaves, returns MiMC(_left, _right)
  */
  function hashLeftRight(uint256 _left, uint256 _right) public pure returns (uint256) {
    require(_left < FIELD_SIZE, "_left should be inside the field");
    require(_right < FIELD_SIZE, "_right should be inside the field");
    uint256 R = _left;
    uint256 C = 0;
    (R, C) = Hasher.MiMCSponge(R, C, 0);
    R = addmod(R, _right, FIELD_SIZE);
    (R, C) = Hasher.MiMCSponge(R, C, 0);
    return R;
  }

  function _insert(uint256 _leaf) internal returns(uint256 index) {
    uint32 currentIndex = nextIndex;
    require(currentIndex != 2**levels, "Merkle tree is full. No more leafs can be added");
    nextIndex += 1;
    uint256 currentLevelHash = _leaf;
    uint256 left;
    uint256 right;

    for (uint256 i = 0; i < levels; i++) {
      if (currentIndex % 2 == 0) {
        left = currentLevelHash;
        right = zeros[i];

        filledSubtrees[i] = currentLevelHash;
      } else {
        left = filledSubtrees[i];
        right = currentLevelHash;
      }

      currentLevelHash = hashLeftRight(left, right);

      currentIndex /= 2;
    }

    currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
    roots[currentRootIndex] = currentLevelHash;
    return nextIndex - 1;
  }

  /**
    @dev Whether the root is present in the root history
  */
  function isKnownRoot(uint256 _root) public view returns(bool) {
    if (_root == 0) {
      return false;
    }
    // search most recent first
    uint256 i;
    for(i = currentRootIndex; i < 2**256 - 1; i--) {
      if (_root == roots[i]) {
        return true;
      }
    }

    // process the rest of roots
    for(i = ROOT_HISTORY_SIZE - 1; i > currentRootIndex; i--) {
      if (_root == roots[i]) {
        return true;
      }
    }
    return false;
  }

  /**
    @dev Returns the last root
  */
  function getLastRoot() public view returns(uint256) {
    return roots[currentRootIndex];
  }
}
