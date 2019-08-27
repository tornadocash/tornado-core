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

import "./MerkleTreeWithHistory.sol";

contract IVerifier {
  function verifyProof(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory input) public returns(bool);
}

contract Mixer is MerkleTreeWithHistory {
  bool public isDepositsEnabled = true;
  // operator can disable new deposits in case of emergency
  // it also receives a relayer fee
  address payable public operator;
  mapping(uint256 => bool) public nullifierHashes;
  // we store all commitments just to prevent accidental deposits with the same commitment
  mapping(uint256 => bool) public commitments;
  IVerifier public verifier;

  event Deposit(uint256 indexed commitment, uint256 leafIndex, uint256 timestamp);
  event Withdraw(address to, uint256 nullifierHash, uint256 fee);

  /**
    @dev The constructor
    @param _verifier the address of SNARK verifier for this contract
    @param _merkleTreeHeight the height of deposits' Merkle Tree
    @param _emptyElement default element of the deposits' Merkle Tree
    @param _operator operator address (see operator above)
  */
  constructor(
    address _verifier,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator
  ) MerkleTreeWithHistory(_merkleTreeHeight, _emptyElement) public {
    verifier = IVerifier(_verifier);
    operator = _operator;
  }

  function _deposit(uint256 commitment) internal {
    require(isDepositsEnabled, "deposits disabled");
    require(!commitments[commitment], "The commitment has been submitted");
    _insert(commitment);
    commitments[commitment] = true;
  }

  function _withdraw(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory input) internal {
    uint256 root = input[0];
    uint256 nullifierHash = input[1];

    require(!nullifierHashes[nullifierHash], "The note has been already spent");

    require(isKnownRoot(root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(verifier.verifyProof(a, b, c, input), "Invalid withdraw proof");

    nullifierHashes[nullifierHash] = true;
  }

  function toggleDeposits() external {
    require(msg.sender == operator, "unauthorized");
    isDepositsEnabled = !isDepositsEnabled;
  }

  function changeOperator(address payable _newAccount) external {
    require(msg.sender == operator, "unauthorized");
    operator = _newAccount;
  }

  function isSpent(uint256 nullifier) public view returns(bool) {
    return nullifierHashes[nullifier];
  }
}
