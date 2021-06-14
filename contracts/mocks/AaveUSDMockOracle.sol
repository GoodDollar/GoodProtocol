pragma solidity >=0.8.0;

contract AaveUSDMockOracle {


	function latestAnswer() public view returns (int256) {
		return 27980000000;
	}
}
