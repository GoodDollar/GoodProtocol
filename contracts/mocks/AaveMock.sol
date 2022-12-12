// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

contract AaveMock is ERC20PresetMinterPauserUpgradeable {
	using SafeMathUpgradeable for uint256;

	constructor() initializer {
		__ERC20PresetMinterPauser_init("AAVE", "Aave");
	}

	function mint(address _to, uint256 _amount) public override {
		_mint(_to, _amount);
	}
}
