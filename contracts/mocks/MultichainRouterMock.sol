// SPDX-License-Identifier: MIT

pragma solidity ^0.8;

import "../Interfaces.sol";

import "hardhat/console.sol";

interface IWrapper {
	function mint(address to, uint256 amount) external returns (bool);

	function burn(address from, uint256 amount) external returns (bool);
}

contract MultichainRouterMock {
	IWrapper wrapper;

	constructor(IWrapper _wrapper) {
		wrapper = _wrapper;
	}

	event AnySwap(
		address token,
		address recipient,
		uint256 amount,
		uint256 chainId
	);

	function anySwapOut(
		address token,
		address recipient,
		uint256 amount,
		uint256 chainId
	) external {
		wrapper.burn(msg.sender, amount);
		emit AnySwap(token, recipient, amount, chainId);
	}
}
