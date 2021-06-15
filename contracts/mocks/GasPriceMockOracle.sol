// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

contract GasPriceMockOracle {
	
	function latestAnswer() public view returns (int256) {
		return 25000000000;
	}
}
