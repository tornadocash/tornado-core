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

import "./Mixer.sol";

contract ETHMixer is Mixer {
  constructor(
    IVerifier _verifier,
    uint256 _denomination,
    uint32 _merkleTreeHeight,
    address _operator
  ) Mixer(_verifier, _denomination, _merkleTreeHeight, _operator) public {
  }

  function _processDeposit() internal {
    require(msg.value == denomination, "Please send `mixDenomination` ETH along with transaction");
  }

  function _processWithdraw(address payable _recipient, address payable _relayer, uint256 _fee, uint256 _refund) internal {
    // sanity checks
    require(msg.value == 0, "Message value is supposed to be zero for ETH mixer");
    require(_refund == 0, "Refund value is supposed to be zero for ETH mixer");

    (bool success, ) = _recipient.call.value(denomination - _fee)("");
    require(success, "payment to _recipient did not go thru");
    if (_fee > 0) {
      (success, ) = _relayer.call.value(_fee)("");
      require(success, "payment to _relayer did not go thru");
    }
  }
    /**
    @dev Migrate state from old mixer to this one.
    @param _commitments deposited commitments from previous contract
    @param _nullifierHashes spent nullifiers from previous contract
  */
  bool public isMigrated = false;
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

  function initializeTreeForMigration(bytes32[] calldata _filledSubtrees, bytes32 _root) external {
    require(!isMigrated, "already migrated");
    filledSubtrees = _filledSubtrees;
    roots[0] = _root;
  }

  function finishMigration() external onlyOperator {
    isMigrated = true;
  }
}
