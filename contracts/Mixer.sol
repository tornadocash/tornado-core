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
  function verifyProof(uint256[8] memory _proof, uint256[6] memory _input) public returns(bool);
}

contract Mixer is MerkleTreeWithHistory {
  uint256 public denomination;
  mapping(uint256 => bool) public nullifierHashes;
  // we store all commitments just to prevent accidental deposits with the same commitment
  mapping(uint256 => bool) public commitments;
  IVerifier public verifier;

  // operator can
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
  event Withdrawal(address to, uint256 nullifierHash, address indexed relayer, uint256 fee);

  /**
    @dev The constructor
    @param _verifier the address of SNARK verifier for this contract
    @param _denomination transfer amount for each deposit
    @param _merkleTreeHeight the height of deposits' Merkle Tree
    @param _operator operator address (see operator comment above)
  */
  constructor(
    IVerifier _verifier,
    uint256 _denomination,
    uint8 _merkleTreeHeight,
    address _operator
  ) MerkleTreeWithHistory(_merkleTreeHeight) public {
    require(_denomination > 0, "denomination should be greater than 0");
    verifier = _verifier;
    operator = _operator;
    denomination = _denomination;
  }

  /**
    @dev Deposit funds into mixer. The caller must send (for ETH) or approve (for ERC20) value equal to or `denomination` of this mixer.
    @param _commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
  function deposit(uint256 _commitment) public payable {
    require(!isDepositsDisabled, "deposits are disabled");
    require(!commitments[_commitment], "The commitment has been submitted");
    uint256 insertedIndex = _insert(_commitment);
    commitments[_commitment] = true;
    _processDeposit();

    emit Deposit(_commitment, insertedIndex, block.timestamp);
  }

  /** @dev this function is defined in a child contract */
  function _processDeposit() internal;

  /**
    @dev Withdraw a deposit from the mixer. `proof` is a zkSNARK proof data, and input is an array of circuit public inputs
    `input` array consists of:
      - merkle root of all deposits in the mixer
      - hash of unique deposit nullifier to prevent double spends
      - the receiver of funds
      - optional fee that goes to the transaction sender (usually a relay)
  */
  function withdraw(uint256[8] memory _proof, uint256[6] memory _input) public payable {
    uint256 root = _input[0];
    uint256 nullifierHash = _input[1];
    address payable receiver = address(_input[2]);
    address payable relayer = address(_input[3]);
    uint256 fee = _input[4];
    uint256 refund = _input[5];
    require(fee <= denomination, "Fee exceeds transfer value");
    require(!nullifierHashes[nullifierHash], "The note has been already spent");

    require(isKnownRoot(root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(verifier.verifyProof(_proof, _input), "Invalid withdraw proof");
    nullifierHashes[nullifierHash] = true;
    _processWithdraw(receiver, relayer, fee, refund);
    emit Withdrawal(receiver, nullifierHash, relayer, fee);
  }

  /** @dev this function is defined in a child contract */
  function _processWithdraw(address payable _receiver, address payable _relayer, uint256 _fee, uint256 _refund) internal;

  /** @dev whether a note is already spent */
  function isSpent(uint256 _nullifierHash) public view returns(bool) {
    return nullifierHashes[_nullifierHash];
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
  function updateVerifier(address _newVerifier) external onlyOperator {
    require(!isVerifierUpdateDisabled, "Verifier updates have been disabled.");
    verifier = IVerifier(_newVerifier);
  }

  /**
    @dev an option for operator to permanently disable verification keys update ability.
    This is supposed to be called after the final trusted setup ceremony is held.
  */
  function disableVerifierUpdate() external onlyOperator {
    isVerifierUpdateDisabled = true;
  }

  /** @dev operator can change his address */
  function changeOperator(address _newOperator) external onlyOperator {
    operator = _newOperator;
  }
}
