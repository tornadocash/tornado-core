pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
  constructor() ERC20("DAIMock", "DAIM") {
  }

  function mint(address receiver, uint256 amount) external {
    _mint(receiver, amount);
  }
}
