// SPDX-License-Identifier: MIXED

// License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../governance/ClaimersDistribution.sol";

// import "hardhat/console.sol";

/* @title Dynamic amount-per-day UBI scheme allowing claim once a day
 */
contract UBIScheme is DAOUpgradeableContract {
	struct Day {
		mapping(address => bool) hasClaimed;
		uint256 amountOfClaimers;
		uint256 claimAmount;
	}

	//daily statistics
	mapping(uint256 => Day) public claimDay;

	//last ubi claim of user
	mapping(address => uint256) public lastClaimed;

	//current day since start of contract
	uint256 public currentDay;

	//starting date of contract, used to determine the hour where daily ubi cycle starts
	uint256 public periodStart;

	// Result of distribution formula
	// calculated each day
	uint256 public dailyUbi;

	// Limits the gas for each iteration at `fishMulti`
	uint256 public iterationGasLimit;

	// Tracks the active users number. It changes when
	// a new user claim for the first time or when a user
	// has been fished
	uint256 public activeUsersCount;

	// Tracks the last withdrawal day of funds from avatar.
	// Withdraw occures on the first daily claim or the
	// first daily fish only
	uint256 public lastWithdrawDay;

	// How long can a user be inactive.
	// After those days the user can be fished
	// (see `fish` notes)
	uint256 public maxInactiveDays;

	// Whether to withdraw GD from avatar
	// before daily ubi calculation
	bool public shouldWithdrawFromDAO;

	//number of days of each UBI pool cycle
	//dailyPool = Pool/cycleLength
	uint256 public cycleLength;

	//the amount of G$ UBI pool for each day in the cycle to be divided by active users
	uint256 public dailyCyclePool;

	//timestamp of current cycle start
	uint256 public startOfCycle;

	//should be 0 for starters so distributionFormula detects new cycle on first day claim
	uint256 public currentCycleLength;

	//dont use first claim, and give ubi as usual
	bool public useFirstClaimPool;

	//minimum amount of users to divide the pool for, renamed from defaultDailyUbi
	uint256 public minActiveUsers;

	// A pool of GD to give to activated users,
	// since they will enter the UBI pool
	// calculations only in the next day,
	// meaning they can only claim in the next
	// day
	IFirstClaimPool public firstClaimPool;

	struct Funds {
		// marks if the funds for a specific day has
		// withdrawn from avatar
		bool hasWithdrawn;
		// total GD held after withdrawing
		uint256 openAmount;
	}

	// Tracks the daily withdraws and the actual amount
	// at the begining of a trading day
	mapping(uint256 => Funds) public dailyUBIHistory;

	// Marks users that have been fished to avoid
	// double fishing
	mapping(address => bool) public fishedUsersAddresses;

	// Total claims per user stat
	mapping(address => uint256) public totalClaimsPerUser;

	bool public paused;

	// Emits when a withdraw has been succeded
	event WithdrawFromDao(uint256 prevBalance, uint256 newBalance);

	// Emits when a user is activated
	event ActivatedUser(address indexed account);

	// Emits when a fish has been succeded
	event InactiveUserFished(
		address indexed caller,
		address indexed fished_account,
		uint256 claimAmount
	);

	// Emits when finishing a `multi fish` execution.
	// Indicates the number of users from the given
	// array who actually been fished. it might not
	// be finished going over all the array if there
	// no gas left.
	event TotalFished(uint256 total);

	// Emits when daily ubi is calculated
	event UBICalculated(uint256 day, uint256 dailyUbi, uint256 blockNumber);

	//Emits whenever a new multi day cycle starts
	event UBICycleCalculated(
		uint256 day,
		uint256 pool,
		uint256 cycleLength,
		uint256 dailyUBIPool
	);

	event UBIClaimed(address indexed claimer, uint256 amount);
	event CycleLengthSet(uint256 newCycleLength);
	event DaySet(uint256 newDay);
	event ShouldWithdrawFromDAOSet(bool ShouldWithdrawFromDAO);

	/**
	 * @dev Constructor
	 * @param _ns the DAO
	 * @param _firstClaimPool A pool for GD to give out to activated users
	 * @param _maxInactiveDays Days of grace without claiming request
	 */
	function initialize(
		INameService _ns,
		IFirstClaimPool _firstClaimPool,
		uint256 _maxInactiveDays
	) public initializer {
		require(_maxInactiveDays > 0, "Max inactive days cannot be zero");
		setDAO(_ns);
		maxInactiveDays = _maxInactiveDays;
		firstClaimPool = _firstClaimPool;
		shouldWithdrawFromDAO = false;
		cycleLength = 30; //30 days
		iterationGasLimit = 185000; //token transfer cost under superfluid
		periodStart = (block.timestamp / (1 days)) * 1 days + 12 hours; //set start time to GMT noon
		startOfCycle = periodStart;
		useFirstClaimPool = address(_firstClaimPool) != address(0);
		minActiveUsers = 1000;
	}

	function setUseFirstClaimPool(bool _use) public {
		_onlyAvatar();
		useFirstClaimPool = _use;
	}

	/**
	 * @dev function that gets the amount of people who claimed on the given day
	 * @param day the day to get claimer count from, with 0 being the starting day
	 * @return an integer indicating the amount of people who claimed that day
	 */
	function getClaimerCount(uint256 day) public view returns (uint256) {
		return claimDay[day].amountOfClaimers;
	}

	/**
	 * @dev function that gets the amount that was claimed on the given day
	 * @param day the day to get claimer count from, with 0 being the starting day
	 * @return an integer indicating the amount that has been claimed on the given day
	 */
	function getClaimAmount(uint256 day) public view returns (uint256) {
		return claimDay[day].claimAmount;
	}

	/**
	 * @dev function that gets count of claimers and amount claimed for the current day
	 * @return the count of claimers and the amount claimed.
	 */
	function getDailyStats() public view returns (uint256, uint256) {
		uint256 today = (block.timestamp - periodStart) / 1 days;
		return (getClaimerCount(today), getClaimAmount(today));
	}

	modifier requireStarted() {
		require(
			paused == false && periodStart > 0 && block.timestamp >= periodStart,
			"not in periodStarted or paused"
		);
		_;
	}

	/**
	 * @dev On a daily basis UBIScheme withdraws tokens from GoodDao.
	 * Emits event with caller address and last day balance and the
	 * updated balance.
	 */
	function _withdrawFromDao() internal {
		IGoodDollar token = nativeToken();
		uint256 prevBalance = token.balanceOf(address(this));
		uint256 toWithdraw = token.balanceOf(address(avatar));
		dao.genericCall(
			address(token),
			abi.encodeWithSignature(
				"transfer(address,uint256)",
				address(this),
				toWithdraw
			),
			address(avatar),
			0
		);
		uint256 newBalance = prevBalance + toWithdraw;
		require(
			newBalance == token.balanceOf(address(this)),
			"DAO transfer has failed"
		);
		emit WithdrawFromDao(prevBalance, newBalance);
	}

	/**
	 * @dev sets the ubi calculation cycle length
	 * @param _newLength the new length in days
	 */
	function setCycleLength(uint256 _newLength) public {
		_onlyAvatar();
		require(_newLength > 0, "cycle must be at least 1 day long");
		cycleLength = _newLength;
		currentCycleLength = 0; //this will trigger a distributionFormula on next claim day
		emit CycleLengthSet(_newLength);
	}

	/**
	 * @dev returns the day count since start of current cycle
	 */
	function currentDayInCycle() public view returns (uint256) {
		return (block.timestamp - startOfCycle) / (1 days);
	}

	/**
	 * @dev The claim calculation formula. Divide the daily pool with
	 * the sum of the active users.
	 * the daily balance is determined by dividing current pool by the cycle length
	 * @return The amount of GoodDollar the user can claim
	 */
	function distributionFormula() internal returns (uint256) {
		setDay();
		// on first day or once in 24 hrs calculate distribution
		//on day 0 all users receive from firstclaim pool
		if (currentDay != lastWithdrawDay || dailyUbi == 0) {
			IGoodDollar token = nativeToken();
			uint256 currentBalance = token.balanceOf(address(this));
			//start early cycle if we can increase the daily UBI pool
			bool shouldStartEarlyCycle = currentBalance / cycleLength >
				dailyCyclePool;

			if (
				currentDayInCycle() >= currentCycleLength || shouldStartEarlyCycle
			) //start of cycle or first time
			{
				if (shouldWithdrawFromDAO) {
					_withdrawFromDao();
					currentBalance = token.balanceOf(address(this));
				}
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
			dailyUbi = dailyCyclePool / max(activeUsersCount, minActiveUsers);
			//update minActiveUsers as claimers grow
			minActiveUsers = max(activeUsersCount / 2, minActiveUsers);

			emit UBICalculated(currentDay, dailyUbi, block.number);
		}

		return dailyUbi;
	}

	function max(uint256 a, uint256 b) private pure returns (uint256) {
		return a >= b ? a : b;
	}

	/**
	 *@dev Sets the currentDay variable to amount of days
	 * since start of contract.
	 */
	function setDay() public {
		uint256 day = (block.timestamp - periodStart) / (1 days);
		if (day > currentDay) {
			currentDay = day;
			emit DaySet(day);
		}
	}

	/**
	 * @dev Checks if the given account has claimed today
	 * @param account to check
	 * @return True if the given user has already claimed today
	 */
	function hasClaimed(address account) public view returns (bool) {
		return claimDay[currentDay].hasClaimed[account];
	}

	/**
	 * @dev Checks if the given account has been owned by a registered user.
	 * @param _account to check
	 * @return True for an existing user. False for a new user
	 */
	function isNotNewUser(address _account) public view returns (bool) {
		if (lastClaimed[_account] > 0) {
			// the sender is not registered
			return true;
		}
		return false;
	}

	/**
	 * @dev Checks weather the given address is owned by an active user.
	 * A registered user is a user that claimed at least one time. An
	 * active user is a user that claimed at least one time but claimed
	 * at least one time in the last `maxInactiveDays` days. A user that
	 * has not claimed for `maxInactiveDays` is an inactive user.
	 * @param _account to check
	 * @return True for active user
	 */
	function isActiveUser(address _account) public view returns (bool) {
		uint256 _lastClaimed = lastClaimed[_account];
		if (isNotNewUser(_account)) {
			uint256 daysSinceLastClaim = (block.timestamp - _lastClaimed) / (1 days);
			if (daysSinceLastClaim < maxInactiveDays) {
				// active user
				return true;
			}
		}
		return false;
	}

	/**
	 * @dev Transfers `amount` DAO tokens to `account`. Updates stats
	 * and emits an event in case of claimed.
	 * In case that `isFirstTime` is true, it awards the user.
	 * @param _account the account which recieves the funds
	 * @param _target the recipient of funds
	 * @param _amount the amount to transfer
	 * @param _isClaimed true for claimed
	 * @param _isFirstTime true for new user or fished user
	 */
	function _transferTokens(
		address _account,
		address _target,
		uint256 _amount,
		bool _isClaimed,
		bool _isFirstTime
	) internal {
		// updates the stats
		if (_isClaimed || _isFirstTime) {
			//in case of fishing dont update stats
			claimDay[currentDay].amountOfClaimers += 1;
			claimDay[currentDay].hasClaimed[_account] = true;
			lastClaimed[_account] = block.timestamp;
			totalClaimsPerUser[_account] += 1;
		}

		// awards a new user or a fished user
		if (_isFirstTime) {
			uint256 awardAmount = firstClaimPool.awardUser(_target);
			claimDay[currentDay].claimAmount += awardAmount;
			emit UBIClaimed(_account, awardAmount);
		} else {
			if (_isClaimed) {
				claimDay[currentDay].claimAmount += _amount;
				emit UBIClaimed(_account, _amount);
			}
			IGoodDollar token = nativeToken();
			require(token.transfer(_target, _amount), "claim transfer failed");
		}
	}

	function estimateNextDailyUBI() public view returns (uint256) {
		uint256 currentBalance = nativeToken().balanceOf(address(this));
		//start early cycle if we can increase the daily UBI pool
		bool shouldStartEarlyCycle = currentBalance / cycleLength > dailyCyclePool;

		uint256 _dailyCyclePool = dailyCyclePool;
		uint256 _dailyUbi;
		if (
			currentDayInCycle() >= currentCycleLength || shouldStartEarlyCycle
		) //start of cycle or first time
		{
			_dailyCyclePool = currentBalance / cycleLength;
		}

		_dailyUbi = _dailyCyclePool / max(activeUsersCount, minActiveUsers);

		return _dailyUbi;
	}

	function checkEntitlement() public view returns (uint256) {
		return checkEntitlement(msg.sender);
	}

	/**
	 * @dev Checks the amount which the sender address is eligible to claim for,
	 * regardless if they have been whitelisted or not. In case the user is
	 * active, then the current day must be equal to the actual day, i.e. claim
	 * or fish has already been executed today.
	 * @return The amount of GD tokens the address can claim.
	 */
	function checkEntitlement(address _member) public view returns (uint256) {
		if (block.timestamp < periodStart) return 0; //not started
		// new user or inactive should recieve the first claim reward
		if (
			useFirstClaimPool &&
			(!isNotNewUser(_member) || fishedUsersAddresses[_member])
		) {
			return firstClaimPool.claimAmount();
		}

		// current day has already been updated which means
		// that the dailyUbi has been updated
		if (
			currentDay == (block.timestamp - periodStart) / (1 days) && dailyUbi > 0
		) {
			return hasClaimed(_member) ? 0 : dailyUbi;
		}
		return estimateNextDailyUBI();
	}

	/**
	 * @dev Function for claiming UBI. Requires contract to be active. Calls distributionFormula,
	 * calculats the amount the account can claims, and transfers the amount to the account.
	 * Emits the address of account and amount claimed.
	 * @param _account The claimer account
	 * @param _target recipient of funds
	 * @return A bool indicating if UBI was claimed
	 */
	function _claim(address _account, address _target) internal returns (bool) {
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
			_transferTokens(_account, _target, newDistribution, true, false);
			return true;
		} else if (!isNotNewUser(_account) || fishedUsersAddresses[_account]) {
			// a unregistered or fished user
			activeUsersCount += 1;
			fishedUsersAddresses[_account] = false;
			if (useFirstClaimPool) {
				_transferTokens(_account, _target, 0, false, true);
			} else {
				_transferTokens(_account, _target, newDistribution, true, false);
			}
			emit ActivatedUser(_account);
			return true;
		}
		return false;
	}

	/**
	 * @dev Function for claiming UBI. Requires contract to be active and claimer to be whitelisted.
	 * Calls distributionFormula, calculats the amount the caller can claim, and transfers the amount
	 * to the caller. Emits the address of caller and amount claimed.
	 * @return A bool indicating if UBI was claimed
	 */
	function claim() public requireStarted returns (bool) {
		address whitelistedRoot = IIdentityV2(nameService.getAddress("IDENTITY"))
			.getWhitelistedRoot(msg.sender);
		require(whitelistedRoot != address(0), "UBIScheme: not whitelisted");
		bool didClaim = _claim(whitelistedRoot, msg.sender);
		address claimerDistribution = nameService.getAddress("GDAO_CLAIMERS");
		if (didClaim && claimerDistribution != address(0)) {
			ClaimersDistribution(claimerDistribution).updateClaim(whitelistedRoot);
		}
		return didClaim;
	}

	function _canFish(address _account) internal view returns (bool) {
		return
			isNotNewUser(_account) &&
			!isActiveUser(_account) &&
			!fishedUsersAddresses[_account];
	}

	function _fish(address _account, bool _withTransfer) internal returns (bool) {
		fishedUsersAddresses[_account] = true; // marking the account as fished so it won't refish

		// making sure that the calculation will be with the correct number of active users in case
		// that the fisher is the first to make the calculation today
		uint256 newDistribution = distributionFormula();
		if (activeUsersCount > 0) {
			activeUsersCount -= 1;
		}
		if (_withTransfer)
			_transferTokens(msg.sender, msg.sender, newDistribution, false, false);
		emit InactiveUserFished(msg.sender, _account, newDistribution);
		return true;
	}

	/**
	 * @dev In order to update users from active to inactive, we give out incentive to people
	 * to update the status of inactive users, this action is called "Fishing". Anyone can
	 * send a tx to the contract to mark inactive users. The "fisherman" receives a reward
	 * equal to the daily UBI (ie instead of the “fished” user). User that “last claimed” > 14
	 * can be "fished" and made inactive (reduces active users count by one). Requires
	 * contract to be active.
	 * @param _account to fish
	 * @return A bool indicating if UBI was fished
	 */
	function fish(address _account) public requireStarted returns (bool) {
		// checking if the account exists. that's been done because that
		// will prevent trying to fish non-existence accounts in the system
		require(_canFish(_account), "can't fish");

		return _fish(_account, true);
	}

	/**
	 * @dev executes `fish` with multiple addresses. emits the number of users from the given
	 * array who actually been tried being fished.
	 * @param _accounts to fish
	 * @return A bool indicating if all the UBIs were fished
	 */
	function fishMulti(address[] memory _accounts)
		public
		requireStarted
		returns (uint256)
	{
		uint256 i;
		uint256 bounty;

		for (; i < _accounts.length; ++i) {
			if (gasleft() < iterationGasLimit) {
				break;
			}
			if (_canFish(_accounts[i])) {
				require(_fish(_accounts[i], false), "fish has failed");
				bounty += dailyUbi;
			}
		}
		if (bounty > 0) {
			_transferTokens(msg.sender, msg.sender, bounty, false, false);
		}
		emit TotalFished(i);
		return i;
	}

	/**
	 * @dev Sets whether to also withdraw GD from avatar for UBI
	 * @param _shouldWithdraw boolean if to withdraw
	 */
	function setShouldWithdrawFromDAO(bool _shouldWithdraw) public {
		_onlyAvatar();
		shouldWithdrawFromDAO = _shouldWithdraw;
		emit ShouldWithdrawFromDAOSet(shouldWithdrawFromDAO);
	}

	function pause(bool _pause) public {
		_onlyAvatar();
		paused = _pause;
	}

	// function upgrade() public {
	// 	_onlyAvatar();
	// 	paused = true;
	// 	activeUsersCount = 50000; //estimated
	// 	dailyUbi = 0; //required so distributionformula will trigger
	// 	cycleLength = 30;
	// 	currentCycleLength = 0; //this will trigger a new cycle calculation in distribution formula
	// 	startOfCycle = block.timestamp - 91 days; //this will trigger a new calculation in distributionFormula
	// 	periodStart = 1646136000;
	// 	maxDailyUBI = 50000;
	// 	distributionFormula();
	// 	emit CycleLengthSet(cycleLength);
	// }

	function setActiveUserCount(uint256 _activeUserCount) public {
		_onlyAvatar();
		activeUsersCount = _activeUserCount;
	}
}
