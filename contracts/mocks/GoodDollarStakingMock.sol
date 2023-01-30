// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../governance/GoodDollarStaking.sol";
import "hardhat/console.sol";

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

	function upgradeFrom(address staker, uint256 amount)
		external
		returns (uint256 shares)
	{
		console.log(
			"from: %s balance: %s",
			address(msg.sender),
			token.balanceOf(msg.sender)
		);
		require(
			msg.sender == nameService.getAddress("GDAO_STAKING"),
			"not GDAO_STAKING"
		);
	}
}
