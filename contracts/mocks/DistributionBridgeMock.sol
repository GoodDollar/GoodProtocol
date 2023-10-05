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
	event BridgeLz(
		address recipient,
		uint256 amount,
		uint256 chainId,
		uint256 fee
	);
	event BridgeAxl(
		address recipient,
		uint256 amount,
		uint256 chainId,
		uint256 fee,
		address gasRefund
	);

	event OnToken(address sender, uint256 amount, bytes data);

	function bridgeToWithLz(
		address target,
		uint256 targetChainId,
		uint256 amount,
		bytes calldata /*adapterParams*/
	) external payable {
		emit BridgeLz(target, amount, targetChainId, msg.value);
	}

	function bridgeToWithAxelar(
		address target,
		uint256 targetChainId,
		uint256 amount,
		address gasRefundAddress
	) external payable {
		emit BridgeAxl(target, amount, targetChainId, msg.value, gasRefundAddress);
	}

	function onTokenTransfer(
		address sender,
		uint256 amount,
		bytes memory data
	) external returns (bool) {
		emit OnToken(sender, amount, data);
		return true;
	}

	function toLzChainId(uint256 chainId) public pure returns (uint16 lzChainId) {
		if (chainId == 1) return 10001;
		if (chainId == 5) return 10121;
		if (chainId == 42220) return 125;
		if (chainId == 44787) return 10125;
		if (chainId == 122) return 138;
	}

	function estimateSendFee(
		uint16 /*_dstChainId*/,
		address /*_fromAddress*/,
		address /*_toAddress*/,
		uint /*_normalizedAmount*/,
		bool /*_useZro*/,
		bytes memory /*_adapterParams*/
	) public view virtual returns (uint nativeFee, uint zroFee) {
		return (5e14, 0);
	}
}
