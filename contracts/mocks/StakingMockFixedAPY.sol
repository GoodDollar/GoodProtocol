// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import { ERC20 as ERC20_OZ } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../staking/utils/StakingRewardsFixedAPY.sol";
import "hardhat/console.sol";

contract StakingMockFixedAPY is ERC20_OZ, StakingRewardsFixedAPY {
	using Math64x64 for int128;

	constructor(uint128 _interestRatePerBlock)
		ERC20_OZ("G$ Savings Mock", "mocksvG$")
	{
		_setAPY(_interestRatePerBlock);
	}

	function sharesSupply() public view virtual override returns (uint256) {
		return totalSupply();
	}

	function sharesOf(address _account)
		public
		view
		virtual
		override
		returns (uint256)
	{
		return balanceOf(_account);
	}

	function setAPY(uint128 _interestRatePerBlock) public {
		_setAPY(_interestRatePerBlock);
	}

	function compound() public view returns (uint256 compoundedSavings) {
		return _compound();
	}

	function compoundNextBlock() public view returns (uint256 compoundedSavings) {
		if (stats.savings == 0 || block.number == stats.lastUpdateBlock) {
			return stats.savings;
		}

		//earned in timespan = (interestRatePerBlock^blocksPassed * savings - savings)/PRECISION
		//earned perToken = earnedInTimeSpan*PRECISION/totalStaked
		//PRECISION cancels out
		int128 compounded = interestRatePerBlockX64.pow(
			block.number + 1 - stats.lastUpdateBlock
		);
		compoundedSavings = compounded.mulu(stats.savings);
	}

	function withdraw(address _from, uint256 _shares)
		public
		returns (uint256 depositComponent, uint256 rewardComponent)
	{
		(depositComponent, rewardComponent) = _withdraw(_from, _shares);
		_burn(_from, _shares);
	}

	function withdrawAndUndo(address _from, uint256 _shares)
		public
		returns (uint256 depositComponent, uint256 rewardComponent)
	{
		(depositComponent, rewardComponent) = withdraw(_from, _shares);
		undoReward(_from, rewardComponent);
	}

	function stake(address _from, uint256 _amount) public {
		uint256 shares = _stake(_from, _amount);
		_mint(_from, shares);
	}

	function undoReward(address _to, uint256 _amount) public {
		uint256 shares = _undoReward(_to, _amount);
		_mint(_to, shares);
	}
}
