// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

contract StakingRewardsFixedAPY {
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

	// last timestamp this staking contract was updated and rewards were calculated
	uint128 public lastUpdateBlock;

	// the amount of reward per token
	uint128 public rewardPerTokenStored;

	// total supply of active stakes
	uint128 public totalStaked;

	// annual percentage yield - rate of return on stake over one year
	// in BPS format. e.g. apy = 500 means 5% (500/10000)
	uint128 public apy;

	// interest rate per one block. Equal to _apy * 1e14 / numberOfBlocksPerYear
	uint128 public interestRatePerBlock;

	uint128 public numberOfBlocksPerYear;

	constructor(uint128 _apy, uint128 _numberOfBlocksPerYear) {
		_setAPY(_apy, _numberOfBlocksPerYear);
	}

	function _setAPY(uint128 _apy, uint128 _numberOfBlocksPerYear) internal {
		apy = _apy;
		numberOfBlocksPerYear = _numberOfBlocksPerYear;
		interestRatePerBlock = (_apy * 1e14) / _numberOfBlocksPerYear;
	}

	modifier updateReward(address account) {
		_updateReward(account);
		_;
	}

	function _rewardPerToken() internal returns (uint256) {
		if (totalStaked == 0) {
			return rewardPerTokenStored;
		}

		//earned in timespan = blocksPassed * interestRatePerBlock * totalStaked/PRECISION
		//earned perToken = earnedInTimeSpan*PRECISION/totalStaked
		//PRECISION and totalStaked cancel out
		return
			rewardPerTokenStored += uint128(
				(block.number - lastUpdateBlock) * interestRatePerBlock
			);
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
		stakersInfo[_from].balance -= uint128(_amount);
	}

	function _stake(address _from, uint256 _amount)
		internal
		virtual
		updateReward(_from)
	{
		require(_amount > 0, "Cannot stake 0");
		totalStaked += uint128(_amount);
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
	}

	/**
	 * @dev keep track of debt to user
	 */
	function _setReward(address _to, uint256 _amount) internal virtual {
		stakersInfo[_to].reward += uint128(_amount);
	}
}
