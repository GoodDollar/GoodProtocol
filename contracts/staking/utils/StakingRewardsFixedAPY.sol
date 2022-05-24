// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./Math64X64.sol";

contract StakingRewardsFixedAPY {
	using Math64x64 for int128;

	// the users stake information
	struct StakerInfo {
		uint128 reward; // the reward amount which should be transfered to the user
		uint128 balance; // the amount of user active stake
		uint128 rewardPerTokenPaid; // rewards that accounted already so should be substracted
		// while calculating rewards of staker
		uint128 rewardsMinted;
	}

	// the user info sheet
	mapping(address => StakerInfo) public stakersInfo;

	// precision constant for math
	uint128 public constant PRECISION = 1e18;

	// last block this staking contract was updated and rewards were calculated
	uint128 public lastUpdateBlock;

	// the amount of reward per token
	uint128 public rewardPerTokenStored;

	// total supply of active stakes
	uint128 public totalStaked;
	uint256 public principle; //total earning compounding interest;

	// annual percentage yield - rate of return on stake over one year;

	// interest rate per one block in 1e18 precision.
	//for example APY=5% then per block = nroot(1+0.05,numberOfBlocksPerYear)
	//nroot(1.05,6000000) = 1.000000008131694
	//in 1e18 = 1000000008131694000
	int128 public interestRatePerBlockX64;

	constructor(uint128 _interestRatePerBlock) {
		_setAPY(_interestRatePerBlock);
	}

	function _setAPY(uint128 _interestRatePerBlock)
		internal
		updateReward(address(0))
	{
		interestRatePerBlockX64 = Math64x64.divu(_interestRatePerBlock, 1e18); //convert to signed int x64
	}

	modifier updateReward(address account) {
		_updateReward(account);
		_;
	}

	function _rewardPerToken() internal returns (uint256) {
		if (totalStaked == 0 || block.number == lastUpdateBlock) {
			return rewardPerTokenStored;
		}

		//earned in timespan = (interestRatePerBlock^blocksPassed * principle - principle)/PRECISION
		//earned perToken = earnedInTimeSpan*PRECISION/totalStaked
		//PRECISION cancels out
		int128 compound = interestRatePerBlockX64.pow(
			block.number - lastUpdateBlock
		);
		uint256 principleWithInterest = compound.mulu(principle);
		principle = principleWithInterest;
		uint256 earnedInterest = principleWithInterest - principle;

		return rewardPerTokenStored += uint128(earnedInterest / totalStaked); //principle is already in PRECISION
	}

	/**
	 * @dev The function allows anyone to calculate the exact amount of reward
	 * earned.
	 * @param account A staker address
	 */
	function earned(address account) public returns (uint256) {
		return
			(stakersInfo[account].balance *
				(_rewardPerToken() - stakersInfo[account].rewardPerTokenPaid)) /
			PRECISION;
	}

	// this function updates the reward for the specific user
	function _updateReward(address _account) internal virtual {
		rewardPerTokenStored = uint128(_rewardPerToken());
		lastUpdateBlock = uint128(block.number);
		if (_account != address(0)) {
			stakersInfo[_account].reward += uint128(earned(_account));
			stakersInfo[_account].rewardPerTokenPaid = rewardPerTokenStored;
		}
	}

	function _withdraw(address _from, uint256 _amount)
		internal
		virtual
		updateReward(_from)
	{
		require(_amount > 0, "Cannot withdraw 0");
		totalStaked -= uint128(_amount);
		principle -= _amount * PRECISION;
		stakersInfo[_from].balance -= uint128(_amount);
	}

	function _stake(address _from, uint256 _amount)
		internal
		virtual
		updateReward(_from)
	{
		require(_amount > 0, "Cannot stake 0");
		totalStaked += uint128(_amount);
		principle += _amount * PRECISION;

		stakersInfo[_from].balance += uint128(_amount);
	}

	function _getReward(address _to)
		internal
		virtual
		updateReward(_to)
		returns (uint256 reward)
	{
		// return and reset the reward if there is any
		reward = stakersInfo[_to].reward;
		stakersInfo[_to].reward = 0;
		stakersInfo[_to].rewardsMinted += uint128(reward);
		principle -= reward * PRECISION; //rewards are part of the compounding interest
	}

	/**
	 * @dev keep track of debt to user in case reward minting failed
	 */
	function _undoReward(address _to, uint256 _amount) internal virtual {
		stakersInfo[_to].reward += uint128(_amount);
		stakersInfo[_to].rewardsMinted -= uint128(_amount);
		principle += _amount * PRECISION; //rewards are part of the compounding interest
	}
}
