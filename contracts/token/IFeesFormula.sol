// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

interface IFeesFormula {
	function getTxFees(
		uint256 value,
		address sender,
		address recipient
	) external view returns (uint256 fee, bool senderPays);
}
