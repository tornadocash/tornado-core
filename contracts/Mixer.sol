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
  function verifyProof(uint256[8] memory proof, uint256[6] memory input) public returns(bool);
}

contract Mixer is MerkleTreeWithHistory {
  uint256 public denomination;
  mapping(uint256 => bool) public nullifierHashes;
  // we store all commitments just to prevent accidental deposits with the same commitment
  mapping(uint256 => bool) public commitments;
  IVerifier public verifier;

  // operator can
  //  - receive a relayer fee
  //  - disable new deposits in case of emergency
  //  - update snark verification key until this ability is permanently disabled
  address public operator;
  bool public isDepositsDisabled;
  bool public isVerifierUpdateDisabled;
  modifier onlyOperator {
    require(msg.sender == operator, "Only operator can call this function.");
    _;
  }

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
    uint256 _denomination,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address _operator
  ) MerkleTreeWithHistory(_merkleTreeHeight, _emptyElement) public {
    verifier = IVerifier(_verifier);
    operator = _operator;
    denomination = _denomination;
  }

  /**
    @dev Deposit funds into mixer. The caller must send (for ETH) or approve (for ERC20) value equal to or `denomination` of this mixer.
    @param commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
  function deposit(uint256 commitment) public payable {
    require(!isDepositsDisabled, "deposits are disabled");
    require(!commitments[commitment], "The commitment has been submitted");
    uint256 insertedIndex = _insert(commitment);
    commitments[commitment] = true;
    _processDeposit();

    emit Deposit(commitment, insertedIndex, block.timestamp);
  }

  /** @dev this function is defined in a child contract */
  function _processDeposit() internal {}

  /**
    @dev Withdraw deposit from the mixer. `proof` is a zkSNARK proof data, and input is an array of circuit public inputs
    `input` array consists of:
      - merkle root of all deposits in the mixer
      - hash of unique deposit nullifier to prevent double spends
      - the receiver of funds
      - optional fee that goes to the transaction sender (usually a relay)
  */
  function withdraw(uint256[8] memory proof, uint256[6] memory input) public payable {
    uint256 root = input[0];
    uint256 nullifierHash = input[1];
    address payable receiver = address(input[2]);
    address payable relayer = address(input[3]);
    uint256 fee = input[4];
    uint256 refund = input[5];
    require(fee <= denomination, "Fee exceeds transfer value");
    require(!nullifierHashes[nullifierHash], "The note has been already spent");

    require(isKnownRoot(root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(verifier.verifyProof(proof, input), "Invalid withdraw proof");
    nullifierHashes[nullifierHash] = true;
    _processWithdraw(receiver, relayer, fee, refund);
    emit Withdraw(receiver, nullifierHash, relayer, fee);
  }

  /** @dev this function is defined in a child contract */
  function _processWithdraw(address payable _receiver, address payable _relayer, uint256 _fee, uint256 _refund) internal {}

  /** @dev whether a note is already spent */
  function isSpent(uint256 nullifier) public view returns(bool) {
    return nullifierHashes[nullifier];
  }

  /**
    @dev Allow operator to temporarily disable new deposits. This is needed to protect users funds in case a vulnerability is discovered.
    It does not affect existing deposits.
  */
  function toggleDeposits(bool _state) external onlyOperator {
    isDepositsDisabled = _state;
  }

  /**
    @dev allow operator to update SNARK verification keys. This is needed to update keys after the final trusted setup ceremony is held.
    After that operator is supposed to permanently disable this ability.
  */
  function updateVerifier(address newVerifier) external onlyOperator {
    require(!isVerifierUpdateDisabled, "Verifier updates have been disabled.");
    verifier = IVerifier(newVerifier);
  }

  /**
    @dev an option for operator to permanently disable verification keys update ability.
    This is supposed to be called after the final trusted setup ceremony is held.
  */
  function disableVerifierUpdate() external onlyOperator {
    isVerifierUpdateDisabled = true;
  }

  /** @dev operator can change his address */
  function changeOperator(address _newAccount) external onlyOperator {
    operator = _newAccount;
  }
}
