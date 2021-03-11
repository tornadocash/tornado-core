// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

interface IDeployer {
  function deploy(bytes memory _initCode, bytes32 _salt) external returns (address payable createdContract);
}
