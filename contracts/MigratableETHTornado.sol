pragma solidity ^0.5.8;

import "./ETHTornado.sol";

contract MigratableETHTornado is ETHTornado {
  bool public isMigrated = false;

  constructor(
    IVerifier _verifier,
    uint256 _denomination,
    uint32 _merkleTreeHeight,
    address _operator
  ) ETHTornado(_verifier, _denomination, _merkleTreeHeight, _operator) public {
  }

  /**
    @dev Migrate state from old v1 tornado.cash instance to this contract.
    @dev only applies to eth 0.1 deposits
    @param _commitments deposited commitments from previous contract
    @param _nullifierHashes spent nullifiers from previous contract
  */
  function migrateState(bytes32[] calldata _commitments, bytes32[] calldata _nullifierHashes) external onlyOperator {
    require(!isMigrated, "Migration is disabled");
    for (uint32 i = 0; i < _commitments.length; i++) {
      commitments[_commitments[i]] = true;
      emit Deposit(_commitments[i], nextIndex + i, block.timestamp);
    }

    nextIndex += uint32(_commitments.length);

    for (uint256 i = 0; i < _nullifierHashes.length; i++) {
      nullifierHashes[_nullifierHashes[i]] = true;
      emit Withdrawal(address(0), _nullifierHashes[i], address(0), 0);
    }
  }

  function initializeTreeForMigration(bytes32[] calldata _filledSubtrees, bytes32 _root) external onlyOperator {
    require(!isMigrated, "already migrated");
    filledSubtrees = _filledSubtrees;
    roots[0] = _root;
  }

  function finishMigration() external payable onlyOperator {
    isMigrated = true;
  }
}
