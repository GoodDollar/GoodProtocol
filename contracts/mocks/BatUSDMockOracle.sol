pragma solidity >=0.8.0;

contract BatUSDMockOracle {
	function latestRoundData()
		public
		view
		returns (
			uint80 roundId,
			int256 answer,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (0, 100000000, 0, 0, 0); // returns 1$ according to easy calculation
	}
}
