pragma solidity >=0.8.0;

contract BatUSDMockOracle {


	function latestAnswer() public view returns (int256) {
		return 100000000; // returns 1$ according to easy calculation
	}
}
