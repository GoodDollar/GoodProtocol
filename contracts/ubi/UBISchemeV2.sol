// SPDX-License-Identifier: MIXED

// License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../governance/ClaimersDistribution.sol";

// import "hardhat/console.sol";

/* @title Dynamic amount-per-day UBI scheme allowing claim once a day
 * V2 does not keep active user count but adds a "reserve factor" of new claimers based on previous day claimers
 */
contract UBISchemeV2 is DAOUpgradeableContract {
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
	uint256 private iterationGasLimit_unused;

	// Tracks the active users number. It changes when
	// a new user claim for the first time or when a user
	// has been fished
	uint256 private activeUsersCount_unused;

	// Tracks the last withdrawal day of funds from avatar.
	// Withdraw occures on the first daily claim or the
	// first daily fish only
	uint256 public lastWithdrawDay;

	// How long can a user be inactive.
	// After those days the user can be fished
	// (see `fish` notes)
	uint256 private maxInactiveDays_unused;

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
	bool private useFirstClaimPool_unused;

	//minimum amount of users to divide the pool for, renamed from defaultDailyUbi
	uint256 public minActiveUsers;

	// A pool of GD to give to activated users,
	// since they will enter the UBI pool
	// calculations only in the next day,
	// meaning they can only claim in the next
	// day
	IFirstClaimPool private firstClaimPool_unused;

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
	mapping(address => bool) private fishedUsersAddresses_unused;

	// Total claims per user stat
	mapping(address => uint256) public totalClaimsPerUser;

	bool public paused;

	uint32 public reserveFactor;

	// Emits when a withdraw has been succeded
	event WithdrawFromDao(uint256 prevBalance, uint256 newBalance);

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
	 */
	function initialize(INameService _ns) public initializer {
		setDAO(_ns);
		shouldWithdrawFromDAO = false;
		cycleLength = 30; //30 days
		periodStart = (block.timestamp / (1 days)) * 1 days + 12 hours; //set start time to GMT noon
		startOfCycle = periodStart;
		minActiveUsers = 1000;
		reserveFactor = 10500;
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
		if (currentDay != lastWithdrawDay || dailyUbi == 0) {
			IGoodDollar token = nativeToken();
			uint256 currentBalance = token.balanceOf(address(this));
			//start early cycle if daily pool size is +%5 previous pool or not enough until end of cycle
			uint256 nextDailyPool = currentBalance / cycleLength;
			bool shouldStartCycle = currentDayInCycle() >= currentCycleLength ||
				(nextDailyPool > (dailyCyclePool * 105) / 100 ||
					currentBalance <
					(dailyCyclePool * (cycleLength - currentDayInCycle())));

			if (shouldStartCycle) //start of cycle or first time
			{
				if (shouldWithdrawFromDAO) {
					_withdrawFromDao();
					currentBalance = token.balanceOf(address(this));
				}
				dailyCyclePool = nextDailyPool;
				currentCycleLength = cycleLength;
				startOfCycle = (block.timestamp / (1 hours)) * 1 hours; //start at a round hour
				emit UBICycleCalculated(
					currentDay,
					currentBalance,
					cycleLength,
					dailyCyclePool
				);
			}

			uint256 prevDayClaimers = claimDay[lastWithdrawDay].amountOfClaimers;
			lastWithdrawDay = currentDay;
			Funds storage funds = dailyUBIHistory[currentDay];
			funds.hasWithdrawn = shouldWithdrawFromDAO;
			funds.openAmount = currentBalance;
			dailyUbi =
				dailyCyclePool /
				max((prevDayClaimers * reserveFactor) / 10000, minActiveUsers);
			//update minActiveUsers as claimers grow
			minActiveUsers = max(prevDayClaimers / 2, minActiveUsers);

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
	 * @dev Transfers `amount` DAO tokens to `account`. Updates stats
	 * and emits an event in case of claimed.
	 * In case that `isFirstTime` is true, it awards the user.
	 * @param _account the account which recieves the funds
	 * @param _target the recipient of funds
	 * @param _amount the amount to transfer
	 */
	function _transferTokens(
		address _account,
		address _target,
		uint256 _amount
	) internal {
		// updates the stats
		claimDay[currentDay].amountOfClaimers += 1;
		claimDay[currentDay].hasClaimed[_account] = true;
		lastClaimed[_account] = block.timestamp;
		totalClaimsPerUser[_account] += 1;
		claimDay[currentDay].claimAmount += _amount;

		emit UBIClaimed(_account, _amount);
		IGoodDollar token = nativeToken();
		require(token.transfer(_target, _amount), "claim transfer failed");
	}

	function estimateNextDailyUBI() public view returns (uint256) {
		uint256 currentBalance = nativeToken().balanceOf(address(this));
		//start early cycle if we can increase the daily UBI pool
		uint256 nextDailyPool = currentBalance / cycleLength;
		bool shouldStartEarlyCycle = nextDailyPool > (dailyCyclePool * 105) / 100 ||
			currentBalance < (dailyCyclePool * (cycleLength - currentDayInCycle()));

		uint256 _dailyCyclePool = dailyCyclePool;
		uint256 _dailyUbi;
		if (
			(currentDayInCycle() + 1) >= currentCycleLength || shouldStartEarlyCycle
		) //start of cycle or first time
		{
			_dailyCyclePool = currentBalance / cycleLength;
		}

		_dailyUbi =
			_dailyCyclePool /
			max(
				(claimDay[currentDay].amountOfClaimers * reserveFactor) / 10000,
				minActiveUsers
			);

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
		if (!hasClaimed(_account)) {
			_transferTokens(_account, _target, newDistribution);
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

	function setNewClaimersReserveFactor(uint32 _reserveFactor) public {
		_onlyAvatar();
		reserveFactor = _reserveFactor;
	}

	function withdraw(uint256 _amount, address _recipient) external {
		_onlyAvatar();
		IGoodDollar token = nativeToken();
		require(token.transfer(_recipient, _amount), "withdraw failed");
	}
}
