// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./Math64X64.sol";
import "hardhat/console.sol";

/***
 * @dev helper contract for calculating fixed per block compounding interest rate rewards.
 * with staker ability to specifiy which percentage of rewards he would like to donate
 */
contract StakingRewardsFixedAPY {
	using Math64x64 for int128;

	// precision constant for math
	uint128 public constant PRECISION = 1e18;
	uint128 public constant SHARE_PRECISION = 1e8;
	uint128 public constant SHARE_DECIMALS = 1e2;

	// the users stake information
	struct StakerInfo {
		uint128 deposit; // the amount of user active stake
		uint128 shares;
		uint128 rewardsPaid; // rewards that accounted already so should be substracted
		uint128 rewardsDonated; //total rewards user has donated so far
		uint128 avgDonationRatio; //donation ratio per share
	}

	struct Stats {
		// last block this staking contract was updated and rewards were calculated
		uint128 lastUpdateBlock;
		// total supply of active stakes
		uint128 totalStaked;
		uint128 totalShares;
		uint128 totalRewardsPaid;
		uint128 totalRewardsDonated;
		uint128 avgDonationRatio;
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

	/**
	 * @notice internal helper to convert unsigned interest rate per block in 1e18 precision to x64 format
	 */
	function _setAPY(uint128 _interestRatePerBlock) internal updateReward {
		interestRatePerBlockX64 = Math64x64.divu(_interestRatePerBlock, 1e18); //convert to signed int x64
	}

	/**
	 * @notice modifier to compound the APY on every state update
	 */
	modifier updateReward() {
		_updateReward();
		_;
	}

	/**
	 * @notice calculates the compounded principle based on passed blocks
	 * @return compoundedPrinciple the new principle
	 */
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

	/**
	 * @notice calculates the current share price (principle/totalShares)
	 * @return price the current share price in SHARE_PRECISION
	 */
	function sharePrice() public view returns (uint256 price) {
		uint256 compoundedPrinciple = _compound();

		// console.log(
		// 	"compoundedPrinciple %s, shares: %s, sharePrice: %s",
		// 	compoundedPrinciple,
		// 	stats.totalShares,
		// 	(compoundedPrinciple * SHARE_PRECISION) / (stats.totalShares * PRECISION)
		// );

		return
			stats.totalShares == 0
				? 0
				: (compoundedPrinciple * SHARE_PRECISION) /
					(stats.totalShares * PRECISION);
	}

	/**
	 * @notice calculate how much user can withdraw after reducing donations
	 * @return balance account principle after donating rewards
	 */
	function getPrinciple(address _account)
		public
		view
		returns (uint256 balance)
	{
		(uint256 earnedRewards, uint256 earnedRewardsAfterDonation) = earned(
			_account
		);

		// console.log(
		// 	"getPrinciple: earned rewards: %s, afterDonation: %s, sharePrice: %s",
		// 	earnedRewards,
		// 	earnedRewardsAfterDonation,
		// 	sharePrice()
		// );
		// console.log("getPrinciple: shares: %s", stakersInfo[_account].shares);

		balance = stakersInfo[_account].deposit;
		uint256 principle = (sharePrice() * stakersInfo[_account].shares) /
			SHARE_PRECISION -
			earnedRewards +
			earnedRewardsAfterDonation;
		balance = principle < balance ? balance : principle; //because of precision loss in initial shares calculation we force principle to be at least as what user deposited
	}

	/**
	 * @notice The function allows anyone to calculate the exact amount of reward
	 * earned.
	 * @param _account A staker address
	 * @return earnedRewards total rewards earned before donations
	 * @return earnedRewardsAfterDonation  rewards earned after donation
	 */
	function earned(address _account)
		public
		view
		returns (uint256 earnedRewards, uint256 earnedRewardsAfterDonation)
	{
		uint256 principle = (sharePrice() * stakersInfo[_account].shares) /
			SHARE_PRECISION;
		earnedRewards = principle < stakersInfo[_account].deposit
			? 0
			: principle - stakersInfo[_account].deposit;
		earnedRewardsAfterDonation =
			(earnedRewards *
				(100 * PRECISION - stakersInfo[_account].avgDonationRatio)) /
			(100 * PRECISION);
	}

	/**
	 * @notice calculate the interest earned and not yet paid for stats.totalStaked
	 * @return rewardsDebt the rewards(interest) not yet paid
	 */
	function getRewardsDebt() external view returns (uint256 rewardsDebt) {
		uint256 rewardsToPay = _compound() - stats.totalStaked * PRECISION; //totalStaked is in G$ precision (ie 2 decimals)
		rewardsDebt =
			(rewardsToPay * (100 * PRECISION - stats.avgDonationRatio)) /
			(100 * PRECISION);
	}

	/**
	 * @notice compounds the global principle
	 */
	function _updateReward() internal virtual {
		stats.principle = _compound();
		stats.lastUpdateBlock = uint128(block.number);
	}

	/**
	 * @notice perform state update when withdrawing
	 * @param _from account address withdrawing
	 * @param _amount amount to withdraw, if amount is max uint then it will withdraw available balance
	 * @return depositComponent how much was withdrawn from user original stake. >0 only when _amount > interest(rewards) earned
	 * @return rewardComponent how much was withdrawn from user earned rewards after donation
	 */
	function _withdraw(address _from, uint256 _amount)
		internal
		virtual
		updateReward
		returns (uint256 depositComponent, uint256 rewardComponent)
	{
		uint256 balance = getPrinciple(_from);
		_amount = _amount == type(uint256).max ? balance : _amount;
		require(_amount > 0 && _amount <= balance, "no balance");

		(uint256 earnedRewards, uint256 earnedRewardsAfterDonation) = earned(_from);
		rewardComponent = earnedRewardsAfterDonation >= _amount
			? _amount
			: earnedRewardsAfterDonation;

		depositComponent = _amount > earnedRewardsAfterDonation
			? _amount - earnedRewardsAfterDonation
			: 0;

		uint256 donatedRewards = earnedRewards - earnedRewardsAfterDonation;
		//we also need to account for the diff between earnedRewards and donated rewards

		//we withdraw donated rewards in same ratio relative the amount withdrawn out of the rewards part
		donatedRewards = earnedRewardsAfterDonation == 0 //avoid div by 0
			? donatedRewards
			: (rewardComponent * donatedRewards) / earnedRewardsAfterDonation;

		_amount += donatedRewards; //we also "withdraw" the donation part from user shares

		uint128 shares = uint128((_amount * SHARE_PRECISION) / sharePrice()); //_amount now includes also donated rewards

		// console.log("withdraw: redeemed shares %s price: %s", shares, sharePrice());

		require(shares > 0, "min withdraw 1 share");

		uint128 sharesAfter = stats.totalShares - shares;
		stats.avgDonationRatio = sharesAfter == 0
			? 0
			: (stats.avgDonationRatio *
				stats.totalShares -
				stakersInfo[_from].avgDonationRatio *
				shares) / sharesAfter;

		// console.log("withdraw: reducing principle by %s", _amount);

		stats.principle -= _amount * PRECISION;
		stats.totalShares = sharesAfter;
		stats.totalStaked -= uint128(depositComponent);
		stats.totalRewardsPaid += uint128(rewardComponent);
		stats.totalRewardsDonated += uint128(donatedRewards);
		stakersInfo[_from].shares -= shares;
		stakersInfo[_from].deposit -= uint128(depositComponent);
		stakersInfo[_from].rewardsPaid += uint128(rewardComponent);
		stakersInfo[_from].rewardsDonated += uint128(donatedRewards);
	}

	/**
	 * @notice perform state update when staking
	 * @param _from account address staking
	 * @param _amount amount to stake
	 * @param _donationRatio how much to donate from the earned interest. in percentages 0-100.
	 */
	function _stake(
		address _from,
		uint256 _amount,
		uint32 _donationRatio
	) internal virtual updateReward {
		require(_donationRatio <= 100, "invalid donation ratio");
		require(_amount > 0, "Cannot stake 0");
		uint128 newShares = uint128(
			stats.totalShares > 0
				? ((_amount * SHARE_PRECISION) / sharePrice()) //amount/sharePrice = new shares = amount/(principle/totalShares)
				: (_amount * SHARE_DECIMALS) //principal/number of shares is shares price, so initially each share price will represent G%cent/SHARE_DECIMALS
		);
		require(newShares > 0, "min stake 1 share price");

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

		stats.avgDonationRatio =
			(stats.avgDonationRatio *
				stats.totalShares +
				_donationRatio *
				PRECISION *
				newShares) /
			(stats.totalShares + newShares);

		stats.totalShares += newShares;
		stats.totalStaked += uint128(_amount);
		stats.principle += _amount * PRECISION;
	}

	/**
	 * @notice keep track of debt to user in case reward minting failed
	 * @dev notice that this should not be called when _rewardsPaidAfterDonation are 0 or when staker avgDonationRatio is 100%
	 */
	function _undoReward(address _to, uint256 _rewardsPaidAfterDonation)
		internal
		virtual
	{
		//skip on invalid input
		if (
			_rewardsPaidAfterDonation == 0 ||
			stakersInfo[_to].avgDonationRatio == 100 * PRECISION
		) {
			return;
		}

		//the actual amount we undo needs to take into account the user donation ratio.
		//rewardsPaidAfterDonation = (100% - donation%) * rewardsBeforeDonation
		//rewadrdsBeforeDonation = rewardsPaidAfterDonation/(100% - donation%)
		uint256 rewardsBeforeDonation = (100 *
			PRECISION *
			_rewardsPaidAfterDonation) /
			(100 * PRECISION - stakersInfo[_to].avgDonationRatio);

		//calculate this before udpating global principle
		uint128 newShares = uint128(
			stats.totalShares > 0
				? ((rewardsBeforeDonation * SHARE_PRECISION) / sharePrice())
				: (rewardsBeforeDonation * SHARE_DECIMALS) //staker previously withdrew all, so shares issued like on first stake
		);
		// console.log(
		// 	"undoReward: increasing principle by %s",
		// 	rewardsBeforeDonation
		// );

		stats.avgDonationRatio =
			(stats.avgDonationRatio *
				stats.totalShares +
				stakersInfo[_to].avgDonationRatio *
				newShares) /
			(stats.totalShares + newShares);

		uint128 rewardsDonated = uint128(
			rewardsBeforeDonation - _rewardsPaidAfterDonation
		);

		stats.totalRewardsPaid -= uint128(_rewardsPaidAfterDonation);
		stats.totalRewardsDonated -= rewardsDonated;
		stats.principle += rewardsBeforeDonation * PRECISION; //rewards are part of the compounding interest
		stats.totalShares += newShares;

		stakersInfo[_to].rewardsPaid -= uint128(_rewardsPaidAfterDonation);
		stakersInfo[_to].rewardsDonated -= rewardsDonated;
		stakersInfo[_to].shares += newShares;
	}
}
