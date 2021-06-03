pragma solidity >0.5.4;

contract EthUSDMockOracle {
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
		return (0, 100000000000, 0, 0, 0); // returns 1000$ according to easy calculation
	}

	function latestAnswer() public view returns (int256) {
		return 100000000000; // returns 1000$ according to easy calculation
	}
}
