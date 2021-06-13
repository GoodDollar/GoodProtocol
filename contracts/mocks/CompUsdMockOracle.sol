// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

contract CompUSDMockOracle {
	function latestRoundData()
		public
		pure
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

	function latestAnswer() public pure returns (int256) {
		return 38813103627;
	}
}
