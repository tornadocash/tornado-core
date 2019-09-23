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
import "@openzeppelin/contracts-ethereum-package/contracts/GSN/GSNRecipient.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/GSN/IRelayHub.sol";

contract ETHMixer is Mixer, GSNRecipient {
  constructor(
    address _verifier,
    uint256 _mixDenomination,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator
  ) Mixer(_verifier, _mixDenomination, _merkleTreeHeight, _emptyElement, _operator) public {
  }

  function _processWithdraw(address payable _receiver) internal {
    _receiver.transfer(mixDenomination);
  }

  function _processDeposit() internal {
    require(msg.value == mixDenomination, "Please send `mixDenomination` ETH along with transaction");
  }

  function withdrawViaRelayer(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[3] memory input) public {
    uint256 root = input[0];
    uint256 nullifierHash = input[1];
    require(!nullifierHashes[nullifierHash], "The note has been already spent");

    require(isKnownRoot(root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(verifier.verifyProof(a, b, c, input), "Invalid withdraw proof");
    nullifierHashes[nullifierHash] = true;
    // we will process withdraw in postRelayedCall func
  }

  // gsn related stuff
  // this func is called by a Relayer via the RelayerHub before sending a tx
  function acceptRelayedCall(
    address relay,
    address from,
    bytes calldata encodedFunction,
    uint256 transactionFee,
    uint256 gasPrice,
    uint256 gasLimit,
    uint256 nonce,
    bytes calldata approvalData,
    uint256 maxPossibleCharge
  ) external view returns (uint256, bytes memory) {
    // think of a withdraw dry-run
    if (_computeCharge(gasLimit, gasPrice, transactionFee) * 2 > mixDenomination) {
      return (1, "Fee exceeds 50% of transfer value");
    }

    if (!compareBytesWithSelector(encodedFunction, this.withdrawViaRelayer.selector)) {
      return (2, "Only withdrawViaRelayer can be called");
    }

    return _approveRelayedCall();
  }

  // this func is called by RelayerHub right before calling a target func
  function preRelayedCall(bytes calldata /*context*/) external returns (bytes32) {}

  event Debug(uint actualCharge, bytes context, address recipient);
  // this func is called by RelayerHub right after calling a target func
  function postRelayedCall(bytes memory context, bool /*success*/, uint actualCharge, bytes32 /*preRetVal*/) public {
    IRelayHub relayHub = IRelayHub(getHubAddr());
    address payable recipient;
    assembly {
      recipient := sload(add(context, 324)) // 4 + (8 * 32) + (32) + (32) == selector + proof + root + nullifier
    }
    emit Debug(actualCharge, context, recipient);

    recipient.transfer(mixDenomination - actualCharge);
    relayHub.depositFor.value(actualCharge)(address(this));
    // or we can send actualCharge somewhere else...
  }

  function compareBytesWithSelector(bytes memory data, bytes4 sel) internal pure returns (bool) {
    return data[0] == sel[0]
        && data[1] == sel[1]
        && data[2] == sel[2]
        && data[3] == sel[3];
  }

  function withdrawFundsFromHub(uint256 amount, address payable dest) external {
    require(msg.sender == operator, "unauthorized");
    IRelayHub(getHubAddr()).withdraw(amount, dest);
  }
}
