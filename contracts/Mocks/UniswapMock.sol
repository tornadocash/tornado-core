pragma solidity ^0.5.0;

import "./ERC20Mock.sol";
import "../IUniswapExchange.sol";

contract UniswapMock is IUniswapExchange {

  ERC20Mock public tokenAddress;
  uint256 public price;

  // EthPurchase: event({buyer: indexed(address), tokens_sold: indexed(uint256), eth_bought: indexed(uint256(wei))})
  event EthPurchase(address buyer, uint256 tokens_sold, uint256 eth_bought);

  constructor(ERC20Mock _token, uint256 _price) public payable {
    tokenAddress = _token;
    price = _price; // in wei
  }


  /*
  * @notice Convert Tokens to ETH.
  * @dev User specifies maximum input and exact output.
  * @param eth_bought Amount of ETH purchased.
  * @param max_tokens Maximum Tokens sold.
  * @param deadline Time after which this transaction can no longer be executed.
  * @return Amount of Tokens sold.
  * @public
  * def tokenToEthSwapOutput(eth_bought: uint256(wei), max_tokens: uint256, deadline: timestamp) -> uint256:
  */
  function tokenToEthSwapOutput(uint256 eth_bought, uint256 /*max_tokens*/, uint256 /*deadline*/) public returns(uint256 tokens_sold) {
    tokens_sold = getTokenToEthOutputPrice(eth_bought);
    tokenAddress.transferFrom(msg.sender, address(this), tokens_sold);
    msg.sender.transfer(eth_bought);
    emit EthPurchase(msg.sender, tokens_sold, eth_bought);
    return eth_bought;
  }

  function getTokenToEthOutputPrice(uint256 eth_bought) public view returns (uint256) {
    return eth_bought * price / 10**18;
  }

   /*
   * @notice Convert Tokens to ETH.
   * @dev User specifies exact input and minimum output.
   * @param tokens_sold Amount of Tokens sold.
   * @param min_eth Minimum ETH purchased.
   * @param deadline Time after which this transaction can no longer be executed.
   * @return Amount of ETH bought.
   * def tokenToEthSwapInput(tokens_sold: uint256, min_eth: uint256(wei), deadline: timestamp) -> uint256(wei):
   */
   function tokenToEthSwapInput(uint256 tokens_sold, uint256 /* min_eth */, uint256 /* deadline */) public returns(uint256) {
     tokenAddress.transferFrom(msg.sender, address(this), tokens_sold);
     uint256 eth_bought = getTokenToEthInputPrice(tokens_sold);
     msg.sender.transfer(eth_bought);
     return eth_bought;
   }

   function getTokenToEthInputPrice(uint256 tokens_sold /* in wei */) public view returns (uint256 eth_bought) {
     return tokens_sold * price / 10**18;
   }

  function setPrice(uint256 _price) external {
    price = _price;
  }

  function() external payable {}
}
