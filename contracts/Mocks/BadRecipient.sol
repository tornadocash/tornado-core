pragma solidity ^0.5.0;

contract BadRecipient {
  function() external {
    require(false, "this contract does not accept ETH");
  }
}
