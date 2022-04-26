// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface ISpendingRateOracle {
	function queryBalance(
		address _faucet,
		uint256 _balance,
		bool isGoodDollar
	) external;

	function getFaucetsThatAcceptFuse() external view returns (address[] memory);

	function getFaucetsThatAcceptGoodDollar() external view returns (address[] memory);

	function getFaucetRequestedAmountInFuse(address _faucet)
		external
		view
		returns (uint256);

	function getFaucetRequestedAmountInGoodDollar(address _faucet)
		external
		view
		returns (uint256);

}
