// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface ISpendingRateOracle {
  function queryBalance(address _faucet, uint256 _balance, address _token) external;
}