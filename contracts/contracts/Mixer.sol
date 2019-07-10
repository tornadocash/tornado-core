pragma solidity ^0.5.8;

import "./MerkleTreeWithHistory.sol";
import "../node_modules/openzeppelin-solidity/contracts/math/SafeMath.sol";

contract IVerifier {
  function verify(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory input) public returns(bool);
}

contract Mixer is MerkleTreeWithHistory {
  using SafeMath for uint256;

  uint256 public transferValue;
  mapping(uint256 => bool) public nullifiers;
  IVerifier verifier;

  event Deposit(address from, uint256 commitment);
  event Withdraw(address to, uint256 nullifier, uint256 fee);

  constructor(address _verifier, uint256 _transferValue) MerkleTreeWithHistory(16, 0) public {
    verifier = IVerifier(_verifier);
    transferValue = _transferValue;
  }

  function deposit(uint256 commitment) public payable {
    require(msg.value == transferValue, "Please send `transferValue` ETH along with transaction");
    _insert(commitment);
    emit Deposit(msg.sender, commitment);
  }

  function withdraw(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory input) public {
    uint256 root = input[0];
    uint256 nullifier = input[1];
    address payable receiver = address(input[2]);
    uint256 fee = input[3];

    require(fee < transferValue, "Fee exceeds transfer value");
    require(!nullifiers[nullifier], "The note has been already spent");
    require(isKnownRoot(root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(verifier.verify(a, b, c, input), "Invalid withdraw proof");

    nullifiers[nullifier] = true;
    receiver.transfer(transferValue - fee);
    if (fee > 0) {
      msg.sender.transfer(fee);
    }
    emit Withdraw(receiver, nullifier, fee);
  }
}
