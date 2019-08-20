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

  constructor(
    address _verifier,
    uint256 _transferValue,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator,
    IERC20 _token
  ) Mixer(_verifier, _transferValue, _merkleTreeHeight, _emptyElement, _operator) public {
    token = _token;
  }

  function deposit(uint256 commitment) public {
    require(token.transferFrom(msg.sender, address(this), transferValue), "Approve before using");
    _deposit(commitment);

    emit Deposit(commitment, next_index - 1, block.timestamp);
  }

  function withdraw(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory input) public {
    _withdraw(a, b, c, input);
    address receiver = address(input[2]);
    uint256 fee = input[3];
    uint256 nullifierHash = input[1];

    require(fee < transferValue, "Fee exceeds transfer value");
    token.transfer(receiver, transferValue - fee);

    if (fee > 0) {
      token.transfer(operator, fee);
    }

    emit Withdraw(receiver, nullifierHash, fee);
  }
}
