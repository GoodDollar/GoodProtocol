// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface PegSwap {
	/**
	 * @notice exchanges the source token for target token
	 * @param sourceAmount count of tokens being swapped
	 * @param source the token that is being given
	 * @param target the token that is being taken
	 */
	function swap(
		uint256 sourceAmount,
		address source,
		address target
	) external;
}
