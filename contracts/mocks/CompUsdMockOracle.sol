// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

contract CompUSDMockOracle {

	function latestAnswer() public pure returns (int256) {
		return 38813103627;
	}
}
