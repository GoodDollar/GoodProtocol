import "../ubi/UBIScheme.sol";

contract SegmentedUBIPool is UBIScheme {
	uint256 public dailyCap;

	function initialize(
		INameService _ns,
		uint256 _maxInactiveDays,
		uint256 _dailyCap
	) public initializer {
		dailyCap = _dailyCap;
		_initialize_ubischeme(
			_ns,
			IFirstClaimPool(address(0)),
			_maxInactiveDays,
			90
		);
	}

	function claim() public override requireStarted returns (bool) {
		//todo:check iswhitelisted in segmentedidentity then _claim
		return _claim(msg.sender);
	}

	/**
	 * @dev Function for claiming UBI. Requires contract to be active. Calls distributionFormula,
	 * calculats the amount the account can claims, and transfers the amount to the account.
	 * Emits the address of account and amount claimed.
	 * @param _account The claimer account
	 * @return A bool indicating if UBI was claimed
	 */
	function _claim(address _account) internal override returns (bool) {
		// calculats the formula up today ie on day 0 there are no active users, on day 1 any user
		// (new or active) will trigger the calculation with the active users count of the day before
		// and so on. the new or inactive users that will become active today, will not take into account
		// within the calculation.
		uint256 newDistribution = distributionFormula();

		// active user which has not claimed today yet, ie user last claimed < today
		if (
			isNotNewUser(_account) &&
			!fishedUsersAddresses[_account] &&
			!hasClaimed(_account)
		) {
			_transferTokens(_account, newDistribution, true, false);
			return true;
		} else if (!isNotNewUser(_account) || fishedUsersAddresses[_account]) {
			// a unregistered or fished user
			activeUsersCount += 1;
			fishedUsersAddresses[_account] = false;
			_transferTokens(_account, 0, true, false); //this is intentionaly the same for both inactive/active here. in contrast to original ubischeme
			emit ActivatedUser(_account);
			return true;
		}
		return false;
	}

	function estimateNextDailyUBI()
		public
		view
		override
		returns (uint256 dailyUBI)
	{
		dailyUBI = super.estimateNextDailyUBI();
		return dailyUBI > dailyCap ? dailyCap : dailyUBI;
	}

	/**
	 * @dev Checks the amount which the sender address is eligible to claim for,
	 * regardless if they have been whitelisted or not. In case the user is
	 * active, then the current day must be equal to the actual day, i.e. claim
	 * or fish has already been executed today.
	 * @return The amount of GD tokens the address can claim.
	 */
	function checkEntitlement()
		public
		view
		override
		requireStarted
		returns (uint256)
	{
		return checkEntitlement(msg.sender);
	}

	function checkEntitlement(address member)
		public
		view
		requireStarted
		returns (uint256)
	{
		// current day has already been updated which means
		// that the dailyUbi has been updated
		if (currentDay == (block.timestamp - periodStart) / (1 days)) {
			return hasClaimed(member) ? 0 : dailyUbi;
		}
		return estimateNextDailyUBI();
	}

	/**
	 * @dev The claim calculation formula. Divide the daily pool with
	 * the sum of the active users.
	 * the daily balance is determined by dividing current pool by the cycle length
	 * enforces daily cap defined
	 * @return The amount of GoodDollar the user can claim
	 */
	function distributionFormula() internal override returns (uint256) {
		setDay();
		// on first day or once in 24 hrs calculate distribution
		//on day 0 all users receive from firstclaim pool
		if (currentDay != lastWithdrawDay) {
			IGoodDollar token = nativeToken();
			uint256 currentBalance = token.balanceOf(address(this));
			//start early cycle if we can increase the daily UBI pool
			bool shouldStartEarlyCycle = currentBalance / cycleLength >
				dailyCyclePool;

			if (
				currentDayInCycle() >= currentCycleLength || shouldStartEarlyCycle
			) //start of cycle or first time
			{
				if (shouldWithdrawFromDAO) _withdrawFromDao();
				currentBalance = token.balanceOf(address(this));
				dailyCyclePool = currentBalance / cycleLength;
				currentCycleLength = cycleLength;
				startOfCycle = (block.timestamp / (1 hours)) * 1 hours; //start at a round hour
				emit UBICycleCalculated(
					currentDay,
					currentBalance,
					cycleLength,
					dailyCyclePool
				);
			}

			lastWithdrawDay = currentDay;
			Funds storage funds = dailyUBIHistory[currentDay];
			funds.hasWithdrawn = shouldWithdrawFromDAO;
			funds.openAmount = currentBalance;
			if (activeUsersCount > 0) {
				dailyUbi = dailyCyclePool / activeUsersCount > dailyCap
					? dailyCyclePool / activeUsersCount
					: dailyCap; //modified from original to include dailycap
			}
			emit UBICalculated(currentDay, dailyUbi, block.number);
		}

		return dailyUbi;
	}
}
