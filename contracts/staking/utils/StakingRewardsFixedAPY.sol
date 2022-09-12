// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./Math64X64.sol";
import "hardhat/console.sol";

/***
 * @dev helper contract for calculating fixed per block compounding interest rate rewards.
 */
abstract contract StakingRewardsFixedAPY {
	using Math64x64 for int128;

	// precision constant for math
	uint128 public constant PRECISION = 1e18;
	uint128 public constant SHARE_PRECISION = 1e18;
	uint128 public constant SHARE_DECIMALS = 1e4;

	// the users stake information
	struct StakerInfo {
		uint128 lastSharePrice; // the share price that can be used to calculate earned rewards
		uint128 rewardsPaid; // rewards that accounted already so should be substracted
	}

	struct Stats {
		// last block this staking contract was updated and rewards were calculated
		uint128 lastUpdateBlock;
		// total supply of active stakes
		uint128 totalStaked;
		uint128 totalRewardsPaid;
		uint256 savings; //total earning compounding interest;
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
	 * @dev the amount of shares of the savings _account holds
	 * @param _account the address
	 */
	function sharesOf(address _account)
		public
		view
		virtual
		returns (uint256 shares);

	/**
	 * @dev the total outstanding shares
	 */
	function sharesSupply() public view virtual returns (uint256);

	/**
	 * @notice calculates the compounded savings based on passed blocks
	 * @return compoundedSavings the new savings
	 */
	function _compound() internal view returns (uint256 compoundedSavings) {
		if (stats.savings == 0 || block.number == stats.lastUpdateBlock) {
			return stats.savings;
		}

		//earned in timespan = (interestRatePerBlock^blocksPassed * savings - savings)/PRECISION
		//earned perToken = earnedInTimeSpan*PRECISION/totalStaked
		//PRECISION cancels out
		int128 compound = interestRatePerBlockX64.pow(
			block.number - stats.lastUpdateBlock
		);
		compoundedSavings = compound.mulu(stats.savings);
	}

	/**
	 * @notice calculates the current share price (savings/totalShares)
	 * @return price the current share price in SHARE_PRECISION
	 */
	function sharePrice() public view returns (uint256 price) {
		uint256 compoundedSavings = _compound();

		// console.log(
		// 	"compoundedSavings %s, shares: %s, sharePrice: %s",
		// 	compoundedSavings,
		// 	stats.totalShares,
		// 	(compoundedSavings * SHARE_PRECISION) / (stats.totalShares * PRECISION)
		// );

		return
			sharesSupply() == 0
				? 0
				: (compoundedSavings * SHARE_PRECISION) / (sharesSupply() * PRECISION);
	}

	/**
	 * @notice calculate how much user can withdraw
	 * @return balance account compounded savings balance
	 */
	function getSavings(address _account)
		external
		view
		returns (uint256 balance)
	{
		balance = (sharePrice() * sharesOf(_account)) / SHARE_PRECISION;
	}

	function ceil(uint256 amount, uint256 precision)
		internal
		pure
		returns (uint256)
	{
		return ((amount + precision - 1) / precision);
	}

	/**
	 * @dev helper to get _amount worth of shares
	 */
	function amountToShares(uint256 _amount)
		public
		view
		returns (uint256 shares)
	{
		return
			ceil(
				(_amount * SHARE_PRECISION * SHARE_DECIMALS) / sharePrice(),
				SHARE_DECIMALS
			); //ceil ensures shares value >= amount
	}

	/**
	 * @dev helper to get _account lastSharePrice, which is used to calculate accumulated rewards since lastSharePrice was updated
	 */
	function lastSharePrice(address _account)
		public
		view
		returns (uint256 price)
	{
		return uint256(stakersInfo[_account].lastSharePrice);
	}

	/**
	 * @dev get the principle of _account (ie estimated original deposit)
	 */
	function principle(address _account)
		external
		view
		returns (uint256 deposited)
	{
		return (lastSharePrice(_account) * sharesOf(_account)) / SHARE_PRECISION;
	}

	/**
	 * @notice The function allows anyone to calculate the exact amount of reward
	 * earned.
	 * @param _account A staker address
	 * @return earnedRewards total rewards earned
	 */
	function earned(address _account)
		public
		view
		returns (uint256 earnedRewards)
	{
		uint256 shares = sharesOf(_account);
		uint256 curPrice = sharePrice();
		uint256 lastPrice = lastSharePrice(_account);
		lastPrice = lastPrice > curPrice ? curPrice : lastPrice; //it could be that share price is lower immediatly after staking

		earnedRewards =
			((curPrice * shares) - (lastPrice * shares)) /
			SHARE_PRECISION;
	}

	/**
	 * @notice calculate the interest earned and not yet paid for stats.totalStaked
	 * @return debt the rewards(interest) not yet paid
	 */
	function getRewardsDebt() external view returns (uint256 debt) {
		debt = _compound() - stats.totalStaked * PRECISION; //totalStaked is in G$ precision (ie 2 decimals)
	}

	/**
	 * @notice compounds the global savings
	 */
	function _updateReward() internal virtual {
		stats.savings = _compound();
		stats.lastUpdateBlock = uint128(block.number);
	}

	/**
	 * @notice perform state update when withdrawing
	 * @param _from account address withdrawing
	 * @param _shares amount to withdraw, if amount is max uint then it will withdraw available balance
	 * @return depositComponent how much was withdrawn from user original stake. >0 only when _amount > interest (rewards) earned
	 * @return rewardComponent how much was withdrawn from user earned rewards
	 */
	function _withdraw(address _from, uint256 _shares)
		internal
		virtual
		updateReward
		returns (uint256 depositComponent, uint256 rewardComponent)
	{
		uint256 sharesBalance = sharesOf(_from);

		require(_shares > 0 && _shares <= sharesBalance, "no balance");

		uint256 amount = (sharePrice() * _shares) / SHARE_PRECISION;

		uint256 pendingRewards = earned(_from);

		rewardComponent = pendingRewards >= amount ? amount : pendingRewards;

		depositComponent = amount > rewardComponent ? amount - rewardComponent : 0;

		//because of rounding down of rewardComponent after some operations this can cause the deposit component to be larger
		//than it actually was
		if (stats.totalStaked < depositComponent) {
			uint256 diff = depositComponent - stats.totalStaked;
			rewardComponent += diff;
			depositComponent = stats.totalStaked;
		}

		require(amount > 0, "min shares withdraw value: 1 gd");

		// console.log("withdraw: reducing principle by %s", _amount);

		stats.savings -= amount * PRECISION;
		stats.totalStaked -= uint128(depositComponent);
		stats.totalRewardsPaid += uint128(rewardComponent);
		stakersInfo[_from].rewardsPaid += uint128(rewardComponent);

		uint256 newShareSupply = sharesSupply() - _shares;
		uint256 newSharePrice = newShareSupply == 0
			? 0
			: (stats.savings * SHARE_PRECISION) / (newShareSupply * PRECISION);

		if (
			depositComponent > 0 ||
			rewardComponent == pendingRewards ||
			newShareSupply == 0
		) //we have withdrawn all rewards so we reset lastSharePrice
		{
			// console.log("withdraw: reset shareprice to: %s", newSharePrice);
			stakersInfo[_from].lastSharePrice = uint128(newSharePrice);
		} else {
			//we set the lastSharePrice to not include remaining rewards value
			stakersInfo[_from].lastSharePrice = uint128(
				newSharePrice -
					((pendingRewards - rewardComponent) * SHARE_PRECISION) /
					(sharesBalance - _shares)
			);
		}
	}

	/**
	 * @notice perform state update when staking
	 * @param _from account address staking
	 * @param _amount amount to stake
	 */
	function _stake(address _from, uint256 _amount)
		internal
		virtual
		updateReward
		returns (uint256 shares)
	{
		require(_amount > 0, "Cannot stake 0");
		shares = sharesSupply() > 0
			? ((_amount * SHARE_PRECISION) / sharePrice()) //amount/sharePrice = new shares = amount/(savings/totalShares)
			: (_amount * SHARE_DECIMALS); //principal/number of shares is shares price, so initially each share price will represent G%cent/SHARE_DECIMALS
		require(shares > 0, "min stake 1 share price");

		stakersInfo[_from].lastSharePrice = uint128(
			sharesOf(_from) == 0
				? (_amount * SHARE_PRECISION) / shares
				: ((sharesOf(_from) * stakersInfo[_from].lastSharePrice) +
					(shares * sharePrice())) / (sharesOf(_from) + shares)
		);
		stats.totalStaked += uint128(_amount);
		stats.savings += _amount * PRECISION;
	}

	/**
	 * @notice keep track of debt to user in case reward minting failed
	 * @dev notice that this should not be called when _rewardsPaid are 0
	 * @return shares added to cover rewards
	 */
	function _undoReward(address _to, uint256 _rewardsPaid)
		internal
		virtual
		returns (uint256 shares)
	{
		//skip on invalid input
		if (_rewardsPaid == 0) {
			return 0;
		}

		//calculate this before udpating global savings
		shares = sharesSupply() > 0
			? ((_rewardsPaid * SHARE_PRECISION) / sharePrice())
			: (_rewardsPaid * SHARE_DECIMALS); //staker previously withdrew all, so shares issued like on first stake

		stats.totalRewardsPaid -= uint128(_rewardsPaid);
		stats.savings += _rewardsPaid * PRECISION; //rewards are part of the compounding interest

		stakersInfo[_to].rewardsPaid -= uint128(_rewardsPaid);

		//remove rewards from the lastSharePrice
		//we set the lastSharePrice to not include unwithdrawn rewards
		//if lastSharePrice is 0 then nothing to do. it means all funds are rewards ie profit
		if (stakersInfo[_to].lastSharePrice > 0) {
			uint256 rewardsSharesPart = (_rewardsPaid * SHARE_PRECISION) /
				(sharesOf(_to) + shares);

			stakersInfo[_to].lastSharePrice = rewardsSharesPart >=
				stakersInfo[_to].lastSharePrice
				? 0
				: uint128(stakersInfo[_to].lastSharePrice - rewardsSharesPart);
		}
	}
}
