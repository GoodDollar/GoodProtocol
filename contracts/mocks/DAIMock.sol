// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

contract DAIMock is ERC20PresetMinterPauserUpgradeable {
	constructor() initializer {
		__ERC20PresetMinterPauser_init("DAI", "DAI");
	}

	function mint(uint256 amount) public returns (uint256) {
		_mint(msg.sender, amount);
		return 0;
	}

	function allocateTo(address recipient, uint256 amount)
		public
		returns (uint256)
	{
		_mint(recipient, amount);
		return 0;
	}
}
