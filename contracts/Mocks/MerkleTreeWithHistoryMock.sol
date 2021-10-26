pragma solidity ^0.7.6;

import '../MerkleTreeWithHistory.sol';

contract MerkleTreeWithHistoryMock is MerkleTreeWithHistory {

  constructor (IHasher _hasher, uint32 _treeLevels) MerkleTreeWithHistory(_treeLevels, _hasher) {}

  function insert(bytes32 _leaf) public {
      _insert(_leaf);
  }
}
