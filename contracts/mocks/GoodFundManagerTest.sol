// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../staking/GoodFundManager.sol";

contract GoodFundManagerTest is GoodFundManager {
	constructor(INameService _ns) initializer GoodFundManager() {
		initialize(_ns);
	}

	/**
	 * @dev Function to test internal sorting functions
	 */
	function testSorting(uint256[] memory data, address[] memory addresses)
		public
		pure
		returns (uint256[] memory, address[] memory)
	{
		quick(data, addresses);
		return (data, addresses);
	}
}
