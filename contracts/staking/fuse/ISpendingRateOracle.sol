// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface ISpendingRateOracle {
	function queryBalance(
		address _faucet,
		uint256 _balance,
		address _token
	) external;

	function getFaucets() external view returns (address[] memory);

	function getFaucetTargetBalance(address _faucet)
		external
		view
		returns (uint256);

	function getFaucetTokenAddress(address _faucet)
		external
		view
		returns (address);
}
