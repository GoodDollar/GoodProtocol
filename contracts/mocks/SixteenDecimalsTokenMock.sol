// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

contract SixteenDecimalsTokenMock is ERC20PresetMinterPauserUpgradeable {
	using SafeMathUpgradeable for uint256;

	constructor() initializer {
		__ERC20PresetMinterPauser_init("SixteenDecimalsToken", "SDT");
	}

	function decimals() public pure override returns (uint8) {
		return 16;
	}
}
