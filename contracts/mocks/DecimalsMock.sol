// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

contract DecimalsMock is ERC20PresetMinterPauserUpgradeable {
	uint8 tokenDecimals;

	constructor(uint8 decimals) initializer {
		__ERC20PresetMinterPauser_init("Eight Decimals Token", "EDT");
		tokenDecimals = decimals;
	}

	function decimals() public view override returns (uint8) {
		return tokenDecimals;
	}
}
