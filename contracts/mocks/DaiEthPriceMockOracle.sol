// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

contract DaiEthPriceMockOracle {

	function latestAnswer() public pure returns (int256) {
		return 341481428801721;
	}
}
