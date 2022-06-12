// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../governance/GoodDollarStaking.sol";

contract GoodDollarStakingMock is GoodDollarStaking {
	constructor(
		INameService _ns,
		uint128 _interestRatePerBlock,
		uint128 _numberOfBlocksPerYear,
		uint32 _daysUntilUpgrade
	)
		GoodDollarStaking(
			_ns,
			_interestRatePerBlock,
			_numberOfBlocksPerYear,
			_daysUntilUpgrade
		)
	{}

	function upgrade() external override {
		_setMonthlyRewards(address(this), 2 ether * 1e6); //2M monthly GOOD
	}

	function transfer(
		address _from,
		address _to,
		uint256 _value
	) external {
		_transfer(_from, _to, _value);
	}
}
