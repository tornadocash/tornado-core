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
  function verifyProof(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[5] memory input) public returns(bool);
}

contract Mixer is MerkleTreeWithHistory {
  bool public isDepositsEnabled = true;
  bool public isVerifierUpdateAllowed = true;
  // operator can disable new deposits in case of emergency
  // it also receives a relayer fee
  address payable public operator;
  mapping(uint256 => bool) public nullifierHashes;
  // we store all commitments just to prevent accidental deposits with the same commitment
  mapping(uint256 => bool) public commitments;
  IVerifier public verifier;
  uint256 public mixDenomination;

  event Deposit(uint256 indexed commitment, uint256 leafIndex, uint256 timestamp);
  event Withdraw(address to, uint256 nullifierHash, address indexed relayer, uint256 fee);

  /**
    @dev The constructor
    @param _verifier the address of SNARK verifier for this contract
    @param _merkleTreeHeight the height of deposits' Merkle Tree
    @param _emptyElement default element of the deposits' Merkle Tree
    @param _operator operator address (see operator above)
  */
  constructor(
    address _verifier,
    uint256 _mixDenomination,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator
  ) MerkleTreeWithHistory(_merkleTreeHeight, _emptyElement) public {
    verifier = IVerifier(_verifier);
    operator = _operator;
    mixDenomination = _mixDenomination;
  }
  /**
    @dev Deposit funds into mixer. The caller must send value equal to `mixDenomination` of this mixer.
    @param commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
  /**
    @dev Deposit funds into the mixer. The caller must send ETH value equal to `userEther` of this mixer.
    The caller also has to have at least `mixDenomination` amount approved for the mixer.
    @param commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
  function deposit(uint256 commitment) public payable {
    require(isDepositsEnabled, "deposits disabled");
    require(!commitments[commitment], "The commitment has been submitted");
    _processDeposit();
    _insert(commitment);
    commitments[commitment] = true;

    emit Deposit(commitment, next_index - 1, block.timestamp);
  }
  /**
    @dev Withdraw deposit from the mixer. `a`, `b`, and `c` are zkSNARK proof data, and input is an array of circuit public inputs
    `input` array consists of:
      - merkle root of all deposits in the mixer
      - hash of unique deposit nullifier to prevent double spends
      - the receiver of funds
      - optional fee that goes to the transaction sender (usually a relay)
  */
  function withdraw(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[5] memory input) public {
    uint256 root = input[0];
    uint256 nullifierHash = input[1];
    address payable receiver = address(input[2]);
    address payable relayer = address(input[3]);
    uint256 fee = input[4];
    require(fee < mixDenomination, "Fee exceeds transfer value");
    require(!nullifierHashes[nullifierHash], "The note has been already spent");

    require(isKnownRoot(root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(verifier.verifyProof(a, b, c, input), "Invalid withdraw proof");
    nullifierHashes[nullifierHash] = true;
    _processWithdraw(receiver, relayer, fee);
    emit Withdraw(receiver, nullifierHash, relayer, fee);
  }

  function toggleDeposits() external {
    require(msg.sender == operator, "unauthorized");
    isDepositsEnabled = !isDepositsEnabled;
  }

  function updateVerifier(address newVerifier) external {
    require(isVerifierUpdateAllowed, "verifier updates are disabled");
    require(msg.sender == operator, "unauthorized");
    verifier = IVerifier(newVerifier);
  }

  function disableVerifierUpdate() external {
    require(msg.sender == operator, "unauthorized");
    isVerifierUpdateAllowed = false;
  }

  function changeOperator(address payable _newAccount) external {
    require(msg.sender == operator, "unauthorized");
    operator = _newAccount;
  }

  function isSpent(uint256 nullifier) public view returns(bool) {
    return nullifierHashes[nullifier];
  }

  function _processDeposit() internal {}
  function _processWithdraw(address payable _receiver, address payable _relayer, uint256 _fee) internal {}

}
