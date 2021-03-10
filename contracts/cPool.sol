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

// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "./ERC20Tornado.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract cPool is ERC20Tornado {
  address public immutable governance = 0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce;
  IERC20 public immutable comp;

  constructor(
    IERC20 _comp,
    IVerifier _verifier,
    IHasher _hasher,
    uint256 _denomination,
    uint32 _merkleTreeHeight,
    IERC20 _token
  ) ERC20Tornado(_verifier, _hasher, _denomination, _merkleTreeHeight, _token) public {
    comp = _comp;
  }

  /// @dev Moves earned yield of the COMP token to the tornado governance contract
  /// To make it work you may need to call `comptroller.claimComp(cPoolAddress)` before
  function claimComp() external {
    comp.transfer(governance, comp.balanceOf(address(this)));
  }
}
