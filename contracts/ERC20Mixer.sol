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

import "./GSNMixer.sol";
import "./IUniswapExchange.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mixer is GSNMixer {
  address public token;
  // ether value to cover network fee (for relayer) and to have some ETH on a brand new address
  uint256 public userEther;
  IUniswapExchange public uniswap;

  constructor(
    address _verifier,
    uint256 _userEther,
    uint8 _merkleTreeHeight,
    uint256 _emptyElement,
    address payable _operator,
    address _token,
    uint256 _mixDenomination,
    IUniswapExchange _uniswap
  ) GSNMixer(_verifier, _mixDenomination, _merkleTreeHeight, _emptyElement, _operator) public {
    token = _token;
    userEther = _userEther;
    uniswap = _uniswap;
    ERC20(token).approve(address(uniswap), 2**256 - 1);
  }

  function _processDeposit() internal {
    require(msg.value == userEther, "Please send `userEther` ETH along with transaction");
    safeErc20TransferFrom(msg.sender, address(this), mixDenomination);
  }

  function _processWithdraw(address payable _receiver, address payable _relayer, uint256 _fee) internal {
    _receiver.transfer(userEther);

    safeErc20Transfer(_receiver, mixDenomination - _fee);
    if (_fee > 0) {
      safeErc20Transfer(_relayer, _fee);
    }
  }

  // this func is called by RelayerHub right after calling a target func
  function postRelayedCall(bytes memory context, bool /*success*/, uint actualCharge, bytes32 /*preRetVal*/) public onlyHub {
    // this require allows to protect againt malicious relay hub that can drain the mixer
    require(couldBeWithdrawn, "could be called only after withdrawViaRelayer");
    couldBeWithdrawn = false;

    IRelayHub relayHub = IRelayHub(getHubAddr());
    address payable recipient;
    uint256 nullifierHash;
    assembly {
      recipient := mload(add(context, 32))
      nullifierHash := mload(add(context, 64))
    }

    uint256 tokensToSell = uniswap.getTokenToEthOutputPrice(actualCharge);
    // require(tokensToSell <= mixDenomination, "price is too high");

    // tokensToSell = tokensToSell.add(tokensToSell.div(50)); // add 2% slippage
    uint256 actualSold = uniswap.tokenToEthSwapOutput(actualCharge, tokensToSell, now);
    //require(actualSold == tokensToSell, "uniswap lies about its prices");

    safeErc20Transfer(recipient, mixDenomination - actualSold);
    relayHub.depositFor.value(actualCharge)(address(this));
    emit Withdraw(recipient, nullifierHash, tx.origin, actualCharge);
  }

  function safeErc20TransferFrom(address from, address to, uint256 amount) internal {
    bool success;
    bytes memory data;
    bytes4 transferFromSelector = 0x23b872dd;
    (success, data) = token.call(
        abi.encodeWithSelector(
            transferFromSelector,
            from, to, amount
        )
    );
    require(success, "not enough allowed tokens");

    // if contract returns some data let's make sure that is `true` according to standard
    if (data.length > 0) {
      assembly {
        success := mload(add(data, 0x20))
      }
      require(success, "not enough allowed tokens. Token returns false.");
    }
  }

  function safeErc20Transfer(address to, uint256 amount) internal {
    bool success;
    bytes memory data;
    bytes4 transferSelector = 0xa9059cbb;
    (success, data) = token.call(
        abi.encodeWithSelector(
            transferSelector,
            to, amount
        )
    );
    require(success, "not enough tokens");

    // if contract returns some data let's make sure that is `true` according to standard
    if (data.length > 0) {
      assembly {
        success := mload(add(data, 0x20))
      }
      require(success, "not enough tokens. Token returns false.");
    }
  }
}
