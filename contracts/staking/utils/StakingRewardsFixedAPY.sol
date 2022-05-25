// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./Math64X64.sol";

contract StakingRewardsFixedAPY {
	using Math64x64 for int128;

	// precision constant for math
	uint128 public constant PRECISION = 1e18;

	// the users stake information
	struct StakerInfo {
		uint128 deposit; // the amount of user active stake
		uint128 shares;
		uint128 rewardsPaid; // rewards that accounted already so should be substracted
		uint128 avgDonationRatio; //donation ratio per share
	}

	struct Stats {
		// last block this staking contract was updated and rewards were calculated
		uint128 lastUpdateBlock;
		// total supply of active stakes
		uint128 totalStaked;
		uint128 totalShares;
		uint128 totalRewardsPaid;
		uint256 principle; //total earning compounding interest;
	}

	Stats public stats;

	// the user info sheet
	mapping(address => StakerInfo) public stakersInfo;

	// interest rate per one block in 1e18 precision.
	//for example APY=5% then per block = nroot(1+0.05,numberOfBlocksPerYear)
	//nroot(1.05,6000000) = 1.000000008131694
	//in 1e18 = 1000000008131694000
	int128 public interestRatePerBlockX64;

	constructor(uint128 _interestRatePerBlock) {
		_setAPY(_interestRatePerBlock);
	}

	function _setAPY(uint128 _interestRatePerBlock) internal updateReward {
		interestRatePerBlockX64 = Math64x64.divu(_interestRatePerBlock, 1e18); //convert to signed int x64
	}

	modifier updateReward() {
		_updateReward();
		_;
	}

	function _compound() internal view returns (uint256 compoundedPrinciple) {
		if (stats.principle == 0 || block.number == stats.lastUpdateBlock) {
			return stats.principle;
		}

		//earned in timespan = (interestRatePerBlock^blocksPassed * principle - principle)/PRECISION
		//earned perToken = earnedInTimeSpan*PRECISION/totalStaked
		//PRECISION cancels out
		int128 compound = interestRatePerBlockX64.pow(
			block.number - stats.lastUpdateBlock
		);
		compoundedPrinciple = compound.mulu(stats.principle);
	}

	function sharePrice() public view returns (uint256 price) {
		uint256 compoundedPrinciple = _compound();
		return compoundedPrinciple / (stats.totalShares * PRECISION);
	}

	/**
	 * @dev calculate how much user can withdraw after reducing donations
	 */
	function getPrinciple(address _account)
		public
		view
		returns (uint256 balance)
	{
		(uint256 earnedRewards, uint256 earnedRewardsAfterDonation) = earned(
			_account
		);
		return
			sharePrice() *
			stakersInfo[_account].shares -
			earnedRewards +
			earnedRewardsAfterDonation;
	}

	/**
	 * @dev The function allows anyone to calculate the exact amount of reward
	 * earned.
	 * @param _account A staker address
	 */
	function earned(address _account)
		public
		view
		returns (uint256 earnedRewards, uint256 earnedRewardsAfterDonation)
	{
		earnedRewards =
			sharePrice() *
			stakersInfo[_account].shares -
			stakersInfo[_account].deposit;
		earnedRewardsAfterDonation =
			(earnedRewards *
				(100 * PRECISION - stakersInfo[_account].avgDonationRatio)) /
			(100 * PRECISION);
	}

	// this function updates the reward for the specific user
	function _updateReward() internal virtual {
		stats.principle = _compound();
		stats.lastUpdateBlock = uint128(block.number);
	}

	function _withdraw(address _from, uint256 _amount)
		internal
		virtual
		updateReward
		returns (uint256 depositComponent, uint256 rewardComponent)
	{
		require(_amount > 0, "Cannot withdraw 0");
		require(_amount <= getPrinciple(_from), "not enough balance");

		(uint256 earnedRewards, uint256 earnedRewardsAfterDonation) = earned(_from);
		rewardComponent = earnedRewardsAfterDonation >= _amount
			? _amount
			: earnedRewardsAfterDonation;

		depositComponent = _amount > earnedRewardsAfterDonation
			? _amount - earnedRewardsAfterDonation
			: 0;
		//we also need to account for the diff between earnedRewards and donated rewards
		uint256 donatedRewards = earnedRewards - earnedRewardsAfterDonation;
		_amount += donatedRewards;

		uint128 shares = uint128(_amount / sharePrice()); //_amount now includes also donated rewards
		require(shares > 0, "min withdraw 1 share");

		stats.principle -= _amount * PRECISION;
		stats.totalShares -= shares;
		stats.totalStaked -= uint128(depositComponent);
		stats.totalRewardsPaid += uint128(rewardComponent);
		stakersInfo[_from].shares -= shares;
		stakersInfo[_from].deposit -= uint128(depositComponent);
		stakersInfo[_from].rewardsPaid += uint128(rewardComponent);
	}

	function _stake(
		address _from,
		uint256 _amount,
		uint32 _donationRatio
	) internal virtual updateReward {
		require(_amount > 0, "Cannot stake 0");
		uint128 newShares = uint128(
			stats.totalShares > 0
				? (_amount / sharePrice()) //amount/sharePrice = new shares = amount/(principle/totalShares)
				: _amount
		);
		stats.totalShares += newShares;
		stats.totalStaked += uint128(_amount);
		stats.principle += _amount * PRECISION;

		stakersInfo[_from].deposit += uint128(_amount);
		uint128 accountShares = stakersInfo[_from].shares;
		stakersInfo[_from].avgDonationRatio =
			(stakersInfo[_from].avgDonationRatio *
				accountShares +
				_donationRatio *
				PRECISION *
				newShares) /
			(accountShares + newShares);
		stakersInfo[_from].shares += newShares;
	}

	// function _getReward(address _to)
	// 	internal
	// 	virtual
	// 	updateReward
	// 	returns (uint256 reward)
	// {
	// 	// return and reset the reward if there is any
	// 	reward = stakersInfo[_to].reward;
	// 	stakersInfo[_to].reward = 0;
	// 	stakersInfo[_to].rewardsMinted += uint128(reward);
	// 	principle -= reward * PRECISION; //rewards are part of the compounding interest
	// }

	/**
	 * @dev keep track of debt to user in case reward minting failed
	 */
	function _undoReward(address _to, uint256 _amount) internal virtual {
		stats.totalRewardsPaid -= uint128(_amount);
		stakersInfo[_to].rewardsPaid -= uint128(_amount);
		stats.principle += _amount * PRECISION; //rewards are part of the compounding interest

		uint128 newShares = uint128(_amount / sharePrice());
		stakersInfo[_to].shares += newShares;
		stats.totalShares += newShares;
	}
}
