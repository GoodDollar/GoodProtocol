pragma solidity >=0.8.0;

contract GasPriceMockOracle {
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
		return (0, 25000000000, 0, 0, 0);
	}

	function latestAnswer() public view returns (int256) {
		return 25000000000;
	}
}
