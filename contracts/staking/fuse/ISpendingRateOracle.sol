// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface ISpendingRateOracle {
	function queryBalance(
		address _faucet,
		uint256 _balance,
		bool isGoodDollar
	) external returns(uint256); // returns debt to the balance in FUSE if there is any

	function getFaucets() external view returns (address[] memory);

	function getFaucetRequestedAmountInFuse(address _faucet)
		external
		view
		returns (uint256);

	function getAmountOfFaucetsThatAcceptGoodDollar()
		external
		view
		returns (uint256);

	function isFaucetAcceptsGoodDollar(address _faucet)
		external
		view
		returns (bool);
}
