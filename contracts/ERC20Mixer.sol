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
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ERC20Mixer is Mixer {
  IERC20 public token;
  // mixed token amount
  uint256 public tokenDenomination;
  // ether value to cover network fee (for relayer) and to have some ETH on a brand new address
  uint256 public etherFeeDenomination;

  constructor(
    address _verifier,
    uint256 _etherFeeDenomination,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator,
    IERC20 _token,
    uint256 _tokenDenomination
  ) Mixer(_verifier, _merkleTreeHeight, _emptyElement, _operator) public {
    token = _token;
    tokenDenomination = _tokenDenomination;
    etherFeeDenomination = _etherFeeDenomination;
  }

  /**
    @dev Deposit funds into the mixer. The caller must send ETH value equal to `etherFeeDenomination` of this mixer.
    The caller also has to have at least `tokenDenomination` amount approved for the mixer.
    @param commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
  function deposit(uint256 commitment) public payable {
    require(msg.value == etherFeeDenomination, "Please send `etherFeeDenomination` ETH along with transaction");
    require(token.transferFrom(msg.sender, address(this), tokenDenomination), "Approve before using");
    _deposit(commitment);

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
  function withdraw(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory input) public {
    _withdraw(a, b, c, input);
    address payable receiver = address(input[2]);
    uint256 fee = input[3];
    uint256 nullifierHash = input[1];

    require(fee < etherFeeDenomination, "Fee exceeds transfer value");
    receiver.transfer(etherFeeDenomination - fee);

    if (fee > 0) {
      operator.transfer(fee);
    }

    token.transfer(receiver, tokenDenomination);

    emit Withdraw(receiver, nullifierHash, fee);
  }
}
