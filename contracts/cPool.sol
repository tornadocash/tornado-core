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

interface IComptroller {
    function claimComp(address holder) external;
}

interface IComptroller {
    function transfer(address dst, uint rawAmount) external returns (bool);
    function balanceOf(address owner) external;
}

contract ERC20Tornado is Tornado {
  IComptroller public comptroller;
  address public immutable governance = 0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce;
  ICOMP public immutable COMP = 0xc00e94Cb662C3520282E6f5717214004A7f26888;

  constructor(IComptroller _comptroller, ICOMP _comp) public {
    comptroller = _comptroller;
    COMP = _comp;
  }

  function moveYeild() {
    comp.claimComp(address(this));
    uint balance = COMP.balanceOf(address(this));
    COMP.transfer(governance, balance);
  }
}
