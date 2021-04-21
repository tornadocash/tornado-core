pragma solidity 0.5.17;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MerkleTreeWithHistory.sol";

contract IVerifier {
  function verifyProof(bytes memory _proof, uint256[6] memory _input) public returns(bool);
}

contract IFeeManager {
  function feeTo() external view returns (address);
  function protocolFeeDivisor() external view returns (uint256);
}

contract Tornado is MerkleTreeWithHistory, ReentrancyGuard {
  uint256 public denomination;
  mapping(bytes32 => bool) public nullifierHashes;
  // we store all commitments just to prevent accidental deposits with the same commitment
  mapping(bytes32 => bool) public commitments;
  IVerifier public verifier;
  IFeeManager public feeManager;

  // owner can update snark verification key
  // after the final trusted setup ceremony owner rights are supposed to be transferred to zero address
  address public owner;
  modifier onlyOwner {
    require(msg.sender == owner, "Only owner can call this function.");
    _;
  }

  event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
  event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee);
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
  event VerifierChanged(address indexed previousVerifier, address indexed newVerifier);
  event EncryptedNote(address indexed sender, bytes encryptedNote);

  /**
    @dev The constructor
    @param _verifier the address of SNARK verifier for this contract
    @param _denomination transfer amount for each deposit
    @param _merkleTreeHeight the height of deposits' Merkle Tree
    @param _owner owner address (see owner comment above)
  */
  constructor(
    IVerifier _verifier,
    IFeeManager _feeManager,
    uint256 _denomination,
    uint32 _merkleTreeHeight,
    address _owner
  ) MerkleTreeWithHistory(_merkleTreeHeight) public {
    require(_denomination > 0, "denomination should be greater than 0");
    verifier = _verifier;
    feeManager = _feeManager;
    owner = _owner;
    denomination = _denomination;
  }

  /**
    @dev Deposit funds into the contract. The caller must send (for ETH) or approve (for ERC20) value equal to or `denomination` of this instance.
    @param _commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
  function deposit(bytes32 _commitment, bytes calldata _encryptedNote) external payable nonReentrant {
    require(!commitments[_commitment], "The commitment has been submitted");

    uint32 insertedIndex = _insert(_commitment);
    commitments[_commitment] = true;
    _processDeposit();

    emit Deposit(_commitment, insertedIndex, block.timestamp);
    emit EncryptedNote(msg.sender, _encryptedNote);
  }

  /** @dev this function is defined in a child contract */
  function _processDeposit() internal;

  /**
    @dev Withdraw a deposit from the contract. `proof` is a zkSNARK proof data, and input is an array of circuit public inputs
    `input` array consists of:
      - merkle root of all deposits in the contract
      - hash of unique deposit nullifier to prevent double spends
      - the recipient of funds
      - optional fee that goes to the transaction sender (usually a relay)
  */
  function withdraw(bytes calldata _proof, bytes32 _root, bytes32 _nullifierHash, address payable _recipient, address payable _relayer, uint256 _fee, uint256 _refund) external payable nonReentrant {
    require(_fee <= denomination, "Fee exceeds transfer value");
    require(!nullifierHashes[_nullifierHash], "The note has been already spent");
    require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(verifier.verifyProof(_proof, [uint256(_root), uint256(_nullifierHash), uint256(_recipient), uint256(_relayer), _fee, _refund]), "Invalid withdraw proof");

    nullifierHashes[_nullifierHash] = true;
    _processWithdraw(_recipient, _relayer, _fee, _refund);
    emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);
  }

  /** @dev this function is defined in a child contract */
  function _processWithdraw(address payable _recipient, address payable _relayer, uint256 _relayer_fee, uint256 _refund) internal;

  /** @dev whether a note is already spent */
  function isSpent(bytes32 _nullifierHash) public view returns(bool) {
    return nullifierHashes[_nullifierHash];
  }

  /** @dev whether an array of notes is already spent */
  function isSpentArray(bytes32[] calldata _nullifierHashes) external view returns(bool[] memory spent) {
    spent = new bool[](_nullifierHashes.length);
    for(uint i = 0; i < _nullifierHashes.length; i++) {
      if (isSpent(_nullifierHashes[i])) {
        spent[i] = true;
      }
    }
  }

  /**
    @dev allow owner to update SNARK verification keys. This is needed to update keys after the final trusted setup ceremony is held.
    After that owner rights are supposed to be transferred to zero address
  */
  function updateVerifier(address _newVerifier) external onlyOwner {
    emit VerifierChanged(address(verifier), _newVerifier);
    verifier = IVerifier(_newVerifier);
  }

  /** @dev owner can change his address */
  function changeOwner(address _newOwner) external onlyOwner {
    emit OwnershipTransferred(owner, _newOwner);
    owner = _newOwner;
  }
}
