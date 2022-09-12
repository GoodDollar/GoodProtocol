// SPDX-License-Identifier: MIT

pragma solidity ^0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../utils/DAOUpgradeableContract.sol";

import "hardhat/console.sol";

contract DistributionBridgeMock {
	event AnySwap(
		address token,
		address recipient,
		uint256 amount,
		uint256 chainId
	);
	event OnToken(address sender, uint256 amount, bytes data);

	function anySwapOut(
		address token,
		address recipient,
		uint256 amount,
		uint256 chainId
	) external {
		emit AnySwap(token, recipient, amount, chainId);
	}

	function anySwapOutUnderlying(
		address token,
		address recipient,
		uint256 amount,
		uint256 chainId
	) external {
		emit AnySwap(token, recipient, amount, chainId);
	}

	function onTokenTransfer(
		address sender,
		uint256 amount,
		bytes memory data
	) external returns (bool) {
		emit OnToken(sender, amount, data);
		return true;
	}
}
