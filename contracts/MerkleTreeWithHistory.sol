pragma solidity ^0.5.8;

library MiMC {
  function MiMCSponge(uint256 in_xL, uint256 in_xR, uint256 in_k) public pure returns (uint256 xL, uint256 xR);
}

contract MerkleTreeWithHistory {
  uint8 levels;

  uint8 constant ROOT_HISTORY_SIZE = 100;
  uint256[] private _roots;
  uint256 public current_root = 0;

  uint256[] private _filled_subtrees;
  uint256[] private _zeros;

  uint32 public next_index = 0;

  event LeafAdded(uint256 leaf, uint32 leaf_index);

  constructor(uint8 tree_levels, uint256 zero_value) public {
    levels = tree_levels;

    _zeros.push(zero_value);
    _filled_subtrees.push(_zeros[0]);

    for (uint8 i = 1; i < levels; i++) {
      _zeros.push(hashLeftRight(_zeros[i-1], _zeros[i-1]));
      _filled_subtrees.push(_zeros[i]);
    }

    _roots = new uint256[](ROOT_HISTORY_SIZE);
    _roots[0] = hashLeftRight(_zeros[levels - 1], _zeros[levels - 1]);
  }

  function hashLeftRight(uint256 left, uint256 right) public pure returns (uint256 mimc_hash) {
    uint256 k = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 R = 0;
    uint256 C = 0;

    R = addmod(R, left, k);
    (R, C) = MiMC.MiMCSponge(R, C, 0);

    R = addmod(R, right, k);
    (R, C) = MiMC.MiMCSponge(R, C, 0);

    mimc_hash = R;
  }

  function _insert(uint256 leaf) internal {
    uint32 leaf_index = next_index;
    uint32 current_index = next_index;
    next_index += 1;

    uint256 current_level_hash = leaf;
    uint256 left;
    uint256 right;

    for (uint8 i = 0; i < levels; i++) {
      if (current_index % 2 == 0) {
        left = current_level_hash;
        right = _zeros[i];

        _filled_subtrees[i] = current_level_hash;
      } else {
        left = _filled_subtrees[i];
        right = current_level_hash;
      }

      current_level_hash = hashLeftRight(left, right);

      current_index /= 2;
    }

    current_root = (current_root + 1) % ROOT_HISTORY_SIZE;
    _roots[current_root] = current_level_hash;

    emit LeafAdded(leaf, leaf_index);
  }

  function isKnownRoot(uint root) public view returns(bool) {
    if (root == 0) {
      return false;
    }
    // search most recent first
    uint256 i;
    for(i = current_root; i < 2**256 - 1; i--) {
      if (root == _roots[i]) {
        return true;
      }
    }
    for(i = ROOT_HISTORY_SIZE - 1; i > current_root; i--) {
      if (root == _roots[i]) {
        return true;
      }
    }
    return false;
  }

  function getLastRoot() public view returns(uint256) {
    return _roots[current_root];
  }

  function roots() public view returns(uint256[] memory) {
    return _roots;
  }

  function filled_subtrees() public view returns(uint256[] memory) {
    return _filled_subtrees;
  }

  function zeros() public view returns(uint256[] memory) {
    return _zeros;
  }
}


