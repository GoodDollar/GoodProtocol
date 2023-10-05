// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

contract GasPriceMockOracle {
	int price = 2500000000;

	function latestAnswer() public view returns (int256) {
		return price;
	}

	function setPrice(int _price) external {
		price = _price;
	}
}
