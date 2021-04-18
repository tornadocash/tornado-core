pragma solidity 0.5.17;

contract FeeManager {
  // Maximum fee of 0.5%
  uint256 constant public MIN_PROTOCOL_FEE_DIVISOR = 200;

  address public feeTo;
  address public feeToSetter;
  uint256 public protocolFeeDivisor;

  constructor(address _feeToSetter) public {
    feeToSetter = _feeToSetter;
  }

  function setFeeTo(address _feeTo) external {
      require(msg.sender == feeToSetter, 'FeeManager: FORBIDDEN');
      require(_feeTo != address(0), 'FeeManager: new feeTo is the zero address');
      feeTo = _feeTo;
  }

  function setFeeToSetter(address _feeToSetter) external {
      require(msg.sender == feeToSetter, 'FeeManager: FORBIDDEN');
      require(_feeToSetter != address(0), 'FeeManager: new feeToSetter is the zero address');
      feeToSetter = _feeToSetter;
  }

  function setProtocolFeeDivisor(uint256 _protocolFeeDivisor) external {
      require(msg.sender == feeToSetter, 'FeeManager: FORBIDDEN');
      require(_protocolFeeDivisor >= MIN_PROTOCOL_FEE_DIVISOR, 'FeeManager: Protocol fee too high');
      protocolFeeDivisor = _protocolFeeDivisor;
  }

  function clearFee() external {
      require(msg.sender == feeToSetter, 'FeeManager: FORBIDDEN');
      protocolFeeDivisor = 0;
  }
}
