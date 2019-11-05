pragma solidity ^0.5.8;

import '../MerkleTreeWithHistory.sol';

contract MerkleTreeWithHistoryMock is MerkleTreeWithHistory {

  constructor (uint8 _treeLevels) MerkleTreeWithHistory(_treeLevels) public {}

  function insert(uint256 _leaf) public {
      _insert(_leaf);
  }
}
