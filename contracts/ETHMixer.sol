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

import "./GSNMixer.sol";

contract ETHMixer is GSNMixer {
  constructor(
    address _verifier,
    uint256 _mixDenomination,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator
  ) GSNMixer(_verifier, _mixDenomination, _merkleTreeHeight, _emptyElement, _operator) public {
  }

  function _processWithdraw(address payable _receiver, address payable _relayer, uint256 _fee) internal {
    _receiver.transfer(mixDenomination - _fee);
    if (_fee > 0) {
      _relayer.transfer(_fee);
    }
  }

  function _processDeposit() internal {
    require(msg.value == mixDenomination, "Please send `mixDenomination` ETH along with transaction");
  }

  event Debug(uint actualCharge, bytes context, address recipient);
  // this func is called by RelayerHub right after calling a target func
  function postRelayedCall(bytes memory context, bool /*success*/, uint actualCharge, bytes32 /*preRetVal*/) public onlyHub {
    IRelayHub relayHub = IRelayHub(getHubAddr());
    address payable recipient;
    uint256 nullifierHash;
    assembly {
      recipient := mload(add(context, 32))
      nullifierHash := mload(add(context, 64))
    }
    emit Debug(actualCharge, context, recipient);

    recipient.transfer(mixDenomination - actualCharge);
    relayHub.depositFor.value(actualCharge)(address(this));
    emit Withdraw(recipient, nullifierHash, tx.origin, actualCharge);
  }
}
