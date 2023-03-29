// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import { ERC20 } from "../Interfaces.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import "hardhat/console.sol";

interface ISwappaRouterV1 {
	struct SwapPayload {
		address[] path;
		address[] pairs;
		bytes[] extras;
		uint256 inputAmount;
		uint256 minOutputAmount;
		uint256 expectedOutputAmount;
		address to;
		uint deadline;
		uint256 partner;
		bytes sig;
	}

	function getOutputAmount(
		address[] calldata path,
		address[] calldata pairs,
		bytes[] calldata extras,
		uint256 inputAmount
	) external view returns (uint256 outputAmount);

	function swapExactInputForOutput(
		SwapPayload calldata details
	) external returns (uint256 outputAmount);
}

contract DexSwapHelper is Ownable {
	enum SwapType {
		MINIMA_EXACT_MINOUTPUT,
		MINIMA_REGULAR,
		V2_EXACT_MINOUTPUT,
		V2_REGULAR,
		V3_EXACT_MINOUTPUT,
		V3_REGULAR
	}
	struct RouterPayload {
		address router;
		SwapType swapType;
	}
	event SwapHelper(
		address from,
		address to,
		address inputToken,
		address outputToken,
		uint inputAmount,
		uint outputAmount,
		uint minOutputAmount,
		SwapType swapType,
		address router
	);

	function onTokenTransfer(
		address from,
		uint256 amount,
		bytes calldata data
	) external returns (bool) {
		(RouterPayload memory router, ISwappaRouterV1.SwapPayload memory swap) = abi
			.decode(data, (RouterPayload, ISwappaRouterV1.SwapPayload));
		(, ISwappaRouterV1.SwapPayload memory orgSwap) = abi.decode(
			data,
			(RouterPayload, ISwappaRouterV1.SwapPayload)
		); //keep a clone of swap, since handlers might modify it

		// console.log("router: %s %s", router.router, uint256(router.swapType));
		// console.log("swap: %s %s", swap.inputAmount, orgSwap.inputAmount);
		require(swap.inputAmount == amount, "wrong transfered amount");
		require(swap.path[0] == msg.sender, "not source token");

		ERC20 outputToken = ERC20(swap.path[swap.path.length - 1]);

		//swap object modified in _handle functions
		uint startBalance = outputToken.balanceOf(orgSwap.to);
		//approve router
		ERC20(msg.sender).approve(router.router, orgSwap.inputAmount);

		uint outputAmount;
		if (
			router.swapType == SwapType.MINIMA_EXACT_MINOUTPUT ||
			router.swapType == SwapType.MINIMA_REGULAR
		) {
			outputAmount = _handleMinimaSwap(from, router, swap);
		} else {
			revert("unsupported swap type");
		}

		uint endBalance = outputToken.balanceOf(orgSwap.to);

		require(
			endBalance >= startBalance + orgSwap.minOutputAmount,
			"swap failed"
		); //verify swap

		emit SwapHelper(
			from,
			orgSwap.to,
			msg.sender,
			orgSwap.path[orgSwap.path.length - 1],
			orgSwap.inputAmount,
			outputAmount,
			orgSwap.minOutputAmount,
			router.swapType,
			router.router
		);
		return true;
	}

	function _handleMinimaSwap(
		address from,
		RouterPayload memory router,
		ISwappaRouterV1.SwapPayload memory swap
	) internal returns (uint) {
		address recipient = swap.to;
		if (router.swapType == SwapType.MINIMA_EXACT_MINOUTPUT) {
			swap.to = address(this);
		}
		uint256 outputAmount = ISwappaRouterV1(router.router)
			.swapExactInputForOutput(swap);

		if (router.swapType == SwapType.MINIMA_EXACT_MINOUTPUT) {
			ERC20 outputToken = ERC20(swap.path[swap.path.length - 1]);
			require(
				outputToken.transfer(recipient, swap.minOutputAmount),
				"exact swap failed"
			);
			uint diff = outputAmount - swap.minOutputAmount;

			//send refund back
			if (diff > 0) {
				require(outputToken.transfer(from, diff), "exact swap failed");
			}
		}
		return outputAmount;
	}

	function getSlippageDust(ERC20 token) external onlyOwner {
		uint balance = token.balanceOf(address(this));
		token.transfer(owner(), balance);
	}
}
