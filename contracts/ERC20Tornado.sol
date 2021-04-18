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

pragma solidity 0.5.17;

import "./Tornado.sol";
import "./SafeMath.sol";

contract ERC20Tornado is Tornado {
  address public token;

  constructor(
    IVerifier _verifier,
    IFeeManager _feeManager,
    uint256 _denomination,
    uint32 _merkleTreeHeight,
    address _operator,
    address _token
  ) Tornado(_verifier, _feeManager, _denomination, _merkleTreeHeight, _operator) public {
    token = _token;
  }

  function _processDeposit() internal {
    require(msg.value == 0, "ETH value is supposed to be 0 for ERC20 instance");
    _safeErc20TransferFrom(msg.sender, address(this), denomination);
  }

  function _processWithdraw(address payable _recipient, address payable _relayer, uint256 _relayer_fee, uint256 _refund) internal {
    require(msg.value == _refund, "Incorrect refund amount received by the contract");

    address feeTo = feeManager.feeTo();
    uint256 protocolFeeDivisor = feeManager.protocolFeeDivisor();

    bool feeOn = feeTo != address(0) && protocolFeeDivisor != 0;
    if (feeOn) {
      uint256 protocolFee = SafeMath.div(denomination, protocolFeeDivisor);
      _safeErc20Transfer(_recipient, SafeMath.sub(denomination, SafeMath.add(_relayer_fee, protocolFee)));
      _safeErc20Transfer(feeTo, protocolFee);
    } else {
      _safeErc20Transfer(_recipient, SafeMath.sub(denomination, _relayer_fee));
    }

    if (_relayer_fee > 0) {
      _safeErc20Transfer(_relayer, _relayer_fee);
    }

    if (_refund > 0) {
      (bool success, ) = _recipient.call.value(_refund)("");
      if (!success) {
        // let's return _refund back to the relayer
        _relayer.transfer(_refund);
      }
    }
  }

  function _safeErc20TransferFrom(address _from, address _to, uint256 _amount) internal {
    (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd /* transferFrom */, _from, _to, _amount));
    require(success, "not enough allowed tokens");

    // if contract returns some data lets make sure that is `true` according to standard
    if (data.length > 0) {
      require(data.length == 32, "data length should be either 0 or 32 bytes");
      success = abi.decode(data, (bool));
      require(success, "not enough allowed tokens. Token returns false.");
    }
  }

  function _safeErc20Transfer(address _to, uint256 _amount) internal {
    (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb /* transfer */, _to, _amount));
    require(success, "not enough tokens");

    // if contract returns some data lets make sure that is `true` according to standard
    if (data.length > 0) {
      require(data.length == 32, "data length should be either 0 or 32 bytes");
      success = abi.decode(data, (bool));
      require(success, "not enough tokens. Token returns false.");
    }
  }
}
