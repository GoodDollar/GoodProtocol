// SPDX-License-Identifier: MIT
pragma solidity >0.5.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "../utils/NameService.sol";

// contract NameServiceMock is NameService, ERC20PresetMinterPauserUpgradeable {
contract NameServiceMock is NameService, ERC20PresetMinterPauserUpgradeable {
  constructor() NameService(){
		__ERC20PresetMinterPauser_init("NameServiceMock", "NSM");
	}

  function authorizeUpgrade(address _address) public {
    _authorizeUpgrade(_address);
  }
}