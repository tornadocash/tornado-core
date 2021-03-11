// SPDX-License-Identifier: MIT

pragma solidity ^0.7.0;

interface ERC20Basic {
  function _totalSupply() external returns (uint256);

  function totalSupply() external view returns (uint256);

  function balanceOf(address who) external view returns (uint256);

  function transfer(address to, uint256 value) external;

  event Transfer(address indexed from, address indexed to, uint256 value);
}

/**
 * @title ERC20 interface
 * @dev see https://github.com/ethereum/EIPs/issues/20
 */
interface IUSDT is ERC20Basic {
  function allowance(address owner, address spender) external view returns (uint256);

  function transferFrom(
    address from,
    address to,
    uint256 value
  ) external;

  function approve(address spender, uint256 value) external;

  event Approval(address indexed owner, address indexed spender, uint256 value);
}
