pragma solidity ^0.5.8;

import '../MerkleTreeWithHistory.sol';

contract MerkleTreeWithHistoryMock is MerkleTreeWithHistory {

  constructor (uint8 tree_levels) MerkleTreeWithHistory(tree_levels) public {}

  function insert(uint256 leaf) public {
      _insert(leaf);
  }
}
