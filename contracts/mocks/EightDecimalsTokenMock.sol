// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

contract EightDecimalsMock is ERC20PresetMinterPauserUpgradeable {
	using SafeMathUpgradeable for uint256;



	constructor() {
		__ERC20PresetMinterPauser_init("Eight Decimals Token", "EDT");
	}

	

	function decimals() public pure override returns (uint8) {
		return 8;
	}
	
}
