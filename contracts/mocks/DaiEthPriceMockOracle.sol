pragma solidity >=0.8.0;

contract DaiEthPriceMockOracle {
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
		return (0, 341481428801721, 0, 0, 0);
	}
}
