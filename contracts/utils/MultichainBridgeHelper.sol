// SPDX-License-Identifier: MIT
/**
 ethereum only helper to use transferAndCall for single tx (without user approve) to bridge over multichain
 */

pragma solidity ^0.8;

import "../Interfaces.sol";

contract MultichainBridgeHelper {
	IMultichainRouter public constant multiChainBridge =
		IMultichainRouter(0x765277EebeCA2e31912C9946eAe1021199B39C61);
	address public constant anyGoodDollar =
		address(0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d);
	address public constant goodDollar =
		address(0x67C5870b4A41D4Ebef24d2456547A03F1f3e094B);

	function onTokenTransfer(
		address sender,
		uint256 amount,
		bytes calldata data
	) external returns (bool) {
		require(msg.sender == goodDollar); //verify this was called from a token transfer
		(address bindaddr, uint256 chainId) = abi.decode(data, (address, uint256));
		require(chainId != 0, "zero chainId");
		bindaddr = bindaddr != address(0) ? bindaddr : sender;

		ERC20(goodDollar).approve(address(multiChainBridge), amount);

		multiChainBridge.anySwapOutUnderlying(
			anyGoodDollar,
			bindaddr,
			amount,
			chainId
		);

		return true;
	}
}
