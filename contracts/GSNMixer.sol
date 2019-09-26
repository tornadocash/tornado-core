pragma solidity ^0.5.8;

import "./Mixer.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/GSN/GSNRecipient.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/GSN/IRelayHub.sol";

contract GSNMixer is Mixer, GSNRecipient {
  constructor(
    address _verifier,
    uint256 _mixDenomination,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator
  ) Mixer(_verifier, _mixDenomination, _merkleTreeHeight, _emptyElement, _operator) public {
  }

  bool couldBeWithdrawn;
  modifier onlyHub() {
    require(msg.sender == getHubAddr(), "only relay hub");
    _;
  }

  function withdrawViaRelayer(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[5] memory input) public {
    uint256 root = input[0];
    uint256 nullifierHash = input[1];
    require(!nullifierHashes[nullifierHash], "The note has been already spent");

    require(isKnownRoot(root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(verifier.verifyProof(a, b, c, input), "Invalid withdraw proof");
    nullifierHashes[nullifierHash] = true;
    couldBeWithdrawn = true;
    // we will process withdraw in postRelayedCall func
  }

  // gsn related stuff
  // this func is called by a Relayer via the RelayerHub before sending a tx
  function acceptRelayedCall(
    address /*relay*/,
    address /*from*/,
    bytes memory encodedFunction,
    uint256 /*transactionFee*/,
    uint256 /*gasPrice*/,
    uint256 /*gasLimit*/,
    uint256 /*nonce*/,
    bytes memory /*approvalData*/,
    uint256 /*maxPossibleCharge*/
  ) public view returns (uint256, bytes memory) {
    // think of a withdraw dry-run
    if (!compareBytesWithSelector(encodedFunction, this.withdrawViaRelayer.selector)) {
      return (1, "Only withdrawViaRelayer can be called");
    }
    bytes memory recipient;
    assembly {
      let dataPointer := add(encodedFunction, 32)
      let nullifierPointer := mload(add(dataPointer, 292)) // 4 + (8 * 32) + (32) == selector + proof + root
      let recipientPointer := mload(add(dataPointer, 324)) // 4 + (8 * 32) + (32) + (32) == selector + proof + root + nullifier
      mstore(recipient, 64) // save array length
      mstore(add(recipient, 32), recipientPointer) // save recipient address
      mstore(add(recipient, 64), nullifierPointer) // save nullifier address
    }
    return (0, recipient);
  }

  // this func is called by RelayerHub right before calling a target func
  function preRelayedCall(bytes calldata /*context*/) external returns (bytes32) {}
  function postRelayedCall(bytes memory context, bool /*success*/, uint actualCharge, bytes32 /*preRetVal*/) public {}

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

  function upgradeRelayHub(address newRelayHub) external {
    require(msg.sender == operator, "unauthorized");
    _upgradeRelayHub(newRelayHub);
  }
}
