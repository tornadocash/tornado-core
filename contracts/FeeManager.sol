pragma solidity 0.5.17;

contract FeeManager {
  // Maximum fee of 0.5%
  uint256 public MIN_PROTOCOL_FEE_DIVISOR = 200;

  address public feeTo;
  address public feeToSetter;
  uint256 public protocolFeeDivisor;

  constructor(address _feeToSetter) public {
    feeToSetter = _feeToSetter;
    protocolFeeDivisor = 0;
  }

  function setFeeTo(address _feeTo) external {
      require(msg.sender == feeToSetter, 'Poof: FORBIDDEN');
      feeTo = _feeTo;
  }

  function setFeeToSetter(address _feeToSetter) external {
      require(msg.sender == feeToSetter, 'Poof: FORBIDDEN');
      feeToSetter = _feeToSetter;
  }

  function setProtocolFeeDivisor(uint256 _protocolFeeDivisor) external {
      require(msg.sender == feeToSetter, 'Poof: FORBIDDEN');
      require(_protocolFeeDivisor >= MIN_PROTOCOL_FEE_DIVISOR, 'Poof: Protocol fee too high');
      protocolFeeDivisor = _protocolFeeDivisor;
  }

  function clearFee() external {
      require(msg.sender == feeToSetter, 'Poof: FORBIDDEN');
      protocolFeeDivisor = 0;
  }
}
