// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../staking/utils/StakingRewardsFixedAPY.sol";

contract StakingMockFixedAPY is StakingRewardsFixedAPY {
	using Math64x64 for int128;

	constructor(uint128 _interestRatePerBlock) {
		_setAPY(_interestRatePerBlock);
	}

	function setAPY(uint128 _interestRatePerBlock) public {
		_setAPY(_interestRatePerBlock);
	}

	function compound() public view returns (uint256 compoundedPrinciple) {
		return _compound();
	}

	function compoundNextBlock()
		public
		view
		returns (uint256 compoundedPrinciple)
	{
		if (stats.principle == 0 || block.number == stats.lastUpdateBlock) {
			return stats.principle;
		}

		//earned in timespan = (interestRatePerBlock^blocksPassed * principle - principle)/PRECISION
		//earned perToken = earnedInTimeSpan*PRECISION/totalStaked
		//PRECISION cancels out
		int128 compounded = interestRatePerBlockX64.pow(
			block.number + 1 - stats.lastUpdateBlock
		);
		compoundedPrinciple = compounded.mulu(stats.principle);
	}

	function withdraw(address _from, uint256 _amount)
		public
		returns (uint256 depositComponent, uint256 rewardComponent)
	{
		return _withdraw(_from, _amount);
	}

	function withdrawAndUndo(address _from, uint256 _amount)
		public
		returns (uint256 depositComponent, uint256 rewardComponent)
	{
		(depositComponent, rewardComponent) = _withdraw(_from, _amount);
		_undoReward(_from, rewardComponent);
	}

	function stake(
		address _from,
		uint256 _amount,
		uint32 _donationRatio
	) public {
		_stake(_from, _amount, _donationRatio);
	}

	function undoReward(address _to, uint256 _amount) public {
		_undoReward(_to, _amount);
	}
}
