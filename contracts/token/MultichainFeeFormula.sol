// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import "./IFeesFormula.sol";

/**
 * This fee formula protects transfering any G$s locked in the now disfunctional multichain bridge
 * by taxing them 100%. also preventing sending funds to the bridge.
 */
contract MultichainFeeFormula is IFeesFormula {
	/**
	 * take any transfered funds from multichain bridge as fee
	 * for other txs fee will stay 0
	 */
	function getTxFees(
		uint256 value,
		address sender,
		address recipient
	) public view returns (uint256 fee, bool senderPays) {
		senderPays = false;

		if (
			sender == address(0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d) ||
			sender == address(0xeC577447D314cf1e443e9f4488216651450DBE7c) ||
			sender == address(0x6738fA889fF31F82d9Fe8862ec025dbE318f3Fde)
		) fee = value;
		if (recipient == address(0xD17652350Cfd2A37bA2f947C910987a3B1A1c60d))
			revert("multichain hack");
	}

	/**
	 * required by old GoodDollar on ethereum
	 */
	function isRegistered() public pure returns (bool) {
		return true;
	}
}
