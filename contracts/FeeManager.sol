pragma solidity 0.5.17;

contract FeeManager {
  address public feeTo;
  address public feeToSetter;

  constructor(address _feeToSetter) public {
    feeToSetter = _feeToSetter;
  }

  function setFeeTo(address _feeTo) external {
      require(msg.sender == feeToSetter, 'Poof: FORBIDDEN');
      feeTo = _feeTo;
  }

  function setFeeToSetter(address _feeToSetter) external {
      require(msg.sender == feeToSetter, 'Poof: FORBIDDEN');
      feeToSetter = _feeToSetter;
  }
}
