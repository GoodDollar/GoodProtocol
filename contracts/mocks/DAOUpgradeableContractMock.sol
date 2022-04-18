// SPDX-License-Identifier: MIT
pragma solidity >0.5.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

import "../utils/DAOUpgradeableContract.sol";

contract DAOUpgradeableContractMock is DAOUpgradeableContract {
  function authorizeUpgrade(address _address) public {
    _authorizeUpgrade(_address);
  }
}