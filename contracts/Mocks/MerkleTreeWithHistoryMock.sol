// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import '../MerkleTreeWithHistory.sol';

contract MerkleTreeWithHistoryMock is MerkleTreeWithHistory {

  constructor (uint32 _treeLevels, Hasher _hasher) MerkleTreeWithHistory(_treeLevels, _hasher) public {}

  function insert(bytes32 _leaf) public {
      _insert(_leaf);
  }
}
