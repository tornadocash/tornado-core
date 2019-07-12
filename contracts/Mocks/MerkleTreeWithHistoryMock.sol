pragma solidity ^0.5.8;

import '../MerkleTreeWithHistory.sol';

contract MerkleTreeWithHistoryMock is MerkleTreeWithHistory {

  constructor (uint8 tree_levels, uint256 zero_value) MerkleTreeWithHistory(tree_levels, zero_value) public {}

  function insert(uint256 leaf) public {
      _insert(leaf);
  }
}
