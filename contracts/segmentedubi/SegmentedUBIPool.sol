// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import "../ubi/UBIScheme.sol";
import "./Interfaces.sol";

contract SegmentedUBIPool is UBIScheme {
	uint256 public claimPeriod;

	uint256 public dailyCap;

	bool public isFixedAmount;

	uint256 public periodCap;

	address public owner;

	bool public isDAOOwned;

	bool public canWithdrawFunds;

	/**
		initializer for beaconproxy
	 */
	function initializeBeacon(address beacon, bytes memory data) public payable {
		require(_getBeacon() == address(0), "initialized");

		assert(
			_BEACON_SLOT == bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)
		);
		_upgradeBeaconToAndCall(beacon, data, false);
	}

	function initialize(UBIPoolSettings memory _settings) public initializer {
		claimPeriod = _settings.claimPeriod;
		isDAOOwned = _settings.isDAOOwned;
		canWithdrawFunds = isDAOOwned ? true : canWithdrawFunds;
		owner = _settings.owner;
		dailyCap = _settings.dailyCap;
		isFixedAmount = _settings.isFixedAmount;
		canWithdrawFunds = _settings.canWithdrawFunds;
		_initialize_ubischeme(
			_settings.ns,
			IFirstClaimPool(address(0)),
			_settings.maxInactiveDays,
			90
		);
	}

	function _onlyAvatar() internal view override {
		require(
			(isDAOOwned == true && address(dao.avatar()) == msg.sender) ||
				owner == msg.sender,
			"only avatar can call this method"
		);
	}

	//override for segmentedidentity
	function claim() public override requireStarted returns (bool) {
		require(
			ISegmentedIdentity(nameService.getAddress("SEGMENTED_IDENTITY"))
				.isWhitelisted(address(this), msg.sender),
			"not whitelisted"
		);
		return _claim(msg.sender);
	}

	//over for claimPeriod usage
	function setDay() public override {
		uint256 day = (block.timestamp - periodStart) / claimPeriod;
		if (day > currentDay) {
			currentDay = day;
			emit DaySet(day);
		}
	}

	//over for dailyCap usage and isFixedAmount
	function estimateNextDailyUBI()
		public
		view
		override
		returns (uint256 dailyUBI)
	{
		if (isFixedAmount) return dailyCap;
		dailyUBI = super.estimateNextDailyUBI();
		return dailyUBI > dailyCap ? dailyCap : dailyUBI;
	}

	//override for claimPeriod usage
	function checkEntitlement(address _member)
		public
		view
		override
		returns (uint256)
	{
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
			currentDay == (block.timestamp - periodStart) / claimPeriod &&
			dailyUbi > 0
		) {
			return hasClaimed(_member) ? 0 : dailyUbi;
		}
		return estimateNextDailyUBI();
	}

	/**
	 * @dev function that gets count of claimers and amount claimed for the current day
	 * @return the count of claimers and the amount claimed.
	 */
	//override for claimPeriod usage
	function getDailyStats() public view override returns (uint256, uint256) {
		uint256 today = (block.timestamp - periodStart) / claimPeriod;
		return (getClaimerCount(today), getClaimAmount(today));
	}

	/**
	 * @dev The claim calculation formula. Divide the daily pool with
	 * the sum of the active users.
	 * the daily balance is determined by dividing current pool by the cycle length
	 * enforces daily cap defined
	 * @return The amount of GoodDollar the user can claim
	 */
	//override for dailyCap and isFixedAmount usage
	function distributionFormula() internal override returns (uint256) {
		super.distributionFormula();
		if (dailyCap > 0 && (dailyUbi < dailyCap || isFixedAmount)) {
			dailyUbi = dailyCap;
			emit UBICalculated(currentDay, dailyUbi, block.number);
		}
		return dailyUbi;
	}

	//disable withdraw from dao
	function setShouldWithdrawFromDAO(bool _shouldWithdraw) public override {}

	function end() public {
		_onlyAvatar();
		require(canWithdrawFunds, "withdraw not allowed");
		IGoodDollar token = nativeToken();
		address to = owner != address(0) ? owner : avatar;
		token.transfer(to, token.balanceOf(address(this)));
	}
}
