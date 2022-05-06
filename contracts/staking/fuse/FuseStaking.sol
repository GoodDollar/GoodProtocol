// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";

import "../utils/StakingRewardsPerEpoch.sol";
import "./utils/GoodDollarSwaps.sol";
import "./utils/ValidatorsManagement.sol";
import "./IConsensus.sol";
import "./ISpendingRateOracle.sol";

contract FuseStaking is
	StakingRewardsPerEpoch,
	GoodDollarSwaps,
	ValidatorsManagement,
	AccessControl
{
	using SafeERC20 for IERC20;

	IUBIScheme public ubiScheme;

	// The amount of BPS representing the part from earnings of the contract that goes
	// to the keeper address. (in FUSE token)
	uint256 public keeperRatio;

	// The amount of BPS representing the part from DAO part of the contracts earnings that goes
	// to the community pool. (in GoodDollar token)
	uint256 public communityPoolRatio;

	// The actual balance of the community pool. (in GoodDollar token)
	uint256 public communityPoolBalance;

	// The minimum giveback BPS amount that should be passed to the stake function. It regulates the minimum
	// amount of any stake that should be grouped and collected to the DAO part.
	uint256 public minGivebackRatio;

	// The mean giveback ratio for each user.
	uint256 public globalGivebackRatio;

	// The mean giveback ratio getting into account pending stakes.
	uint256 public pendingGivebackRatio;

	// The mean giveback ratios per user.
	mapping(address => uint256) public giveBackRatioPerUser;

	// A spending rate oracle for faucets.
	ISpendingRateOracle public spendingRateOracle;

	// An UBI day from ubischeme.
	uint256 public lastDayCollected;

	event UBICollected(
		uint256 indexed currentDay, // a number of the day when last collectUBIInterest occured.
		uint256 ubiAmount, // G$ sent to ubischeme.
		uint256 communityPoolAmount, // G$ added to pool.
		uint256 gdBoughtAmount, // Actual G$ we got out of swapping stakingRewards + pendingFuseEarnings.
		uint256 stakingRewardsAmount, // Rewards earned since previous collection,
		uint256 totalDebt, // New balance of fuse pending to be swapped for G$
		address keeper, // Keeper address.
		uint256 keeperFuseFee
	);

	// classic ERC20 events
	event Transfer(address indexed from, address indexed to, uint256 value);
	event Approval(address indexed owner, address indexed spender, uint256 value);

	// A role for guardian
	bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

	// A classic ERC20 function
	mapping(address => mapping(address => uint256)) public allowance;

	// The debt in FUSE which is accumulated when the slippage is too big.
	// In the next epoch it'll be tried to distribute again.
	uint256 public debtToStakers;

	// The debt in FUSE which is accumulated when the slippage is too big.
	// In the next epoch it'll be tried to distribute to the faucets again.
	uint256 public debtToDAO;

	// A rewards token, in this case - GoodDollar.
	address internal _rewardsToken;

	constructor(address __rewardsToken)
		StakingRewardsPerEpoch()
	{
		_rewardsToken = __rewardsToken;
	}

	/**
	 * @dev This function allow users to stake the FUSE.
	 * @param _giveBackRatio An amount of BPS which defines the part of
	 * his stake the user are willing to give to the DAO.
	 */
	function stake(uint256 _giveBackRatio) public payable {
		stake(address(0), _giveBackRatio);
	}

	/**
	 * @dev This function allow users to stake the FUSE and define the specific validator
	 * to which the users are willing to stake to.
	 * @param _validator An address of the specific validator.
	 * @param _giveBackRatio An amount of BPS which defines the part of
	 * his stake the user are willing to give to the DAO.
	 */
	function stake(address _validator, uint256 _giveBackRatio)
		public
		payable
		nonReentrant
		whenNotPaused
		updateReward(msg.sender)
	{
		require(msg.value > 0, "stake must be > 0");
		_stake(msg.sender, _validator, msg.value, _giveBackRatio);
	}

	// An inner function which updates the pending stake and connects
	// the staker to the current epoch of his stake.
	function _stake(address _from, uint256 _amount) internal override {
		pendingStakes += _amount;
		stakersInfo[_from].pendingStake += _amount;
		stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		emit Staked(_from, _amount, lastEpochIndex);
	}

	// An inner function which checks if the FUSE validators are
	// available to stake, then check if the giveback ratio specified by
	// the staker is valid, then updates both global and per user means of the
	// giveback statistics, then performs a stake.
	function _stake(
		address _from,
		address _validator,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		_requireValidValidator(_validator);
		require(
			_giveBackRatio >= minGivebackRatio,
			"giveback should be higher or equal to minimum"
		);
		require(_stakeNextValidator(_amount, _validator), "stakeFailed");
		_updateGiveBackRatiosAndStake(_from, _amount, _giveBackRatio);
		_stake(_from, _amount);
		emit Staked(_from, _amount, lastEpochIndex);
	}

	// An inner function for statistics calculation and staking.
	function _updateGiveBackRatiosAndStake(
		address _from,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		// Calculate and update the weighted means per user and global of give back ratio.
		_updateGivebackRatioForStakerAndPending(_from, _amount, _giveBackRatio);
		// Perform stake, which will be distributed to all the validators
		// stored in this contract.
		_stake(_from, _amount);
	}

	// Tshe calculation of the giveback statistics itself.
	function _updateGivebackRatioForStakerAndPending(
		address _from,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		// Calculate a weighted mean for the user.
		giveBackRatioPerUser[_from] = _weightedAverage(
			giveBackRatioPerUser[_from],
			stakersInfo[_from].balance,
			_giveBackRatio,
			_amount
		);
		// Calculate a weighted mean for all the users getting into accountd
		// the pending stakes.
		pendingGivebackRatio = _weightedAverage(
			pendingGivebackRatio,
			pendingStakes,
			_giveBackRatio,
			_amount
		);
	}

	// Calculate and update the global giveback ratio mean. The calculation is
	// made accounting the total supply of active stakes.
	function _updateGlobalGivebackRatio() internal {
		globalGivebackRatio = _weightedAverage(
			globalGivebackRatio,
			totalSupply,
			pendingGivebackRatio,
			pendingStakes
		);
	}

	/**
	 * @dev Calculates the weighted average of two values based on their weights.
	 * @param valueA The amount for value A
	 * @param weightA The weight to use for value A
	 * @param valueB The amount for value B
	 * @param weightB The weight to use for value B
	 */
	function _weightedAverage(
		uint256 valueA,
		uint256 weightA,
		uint256 valueB,
		uint256 weightB
	) internal pure returns (uint256) {
		return (valueA * weightA + valueB * weightB) / (weightA + weightB);
	}

	/**
	 * @dev This function allow users to withdraw their FUSE.
	 * @param amount An amount of FUSE which was staked and are to be withdrawn.
	 */
	function withdraw(uint256 amount) public nonReentrant {
		require(amount > 0, "cannotWithdraw0");
		_withdraw(msg.sender, msg.sender, amount);
	}

	// An inner function for withdrawal.
	function _withdraw(address _from, uint256 _amount) internal override {
		// If we have some pending balance, withdaw it.
		if (stakersInfo[_from].pendingStake > 0) {
			uint256 pendingToReduce = stakersInfo[_from].pendingStake >= _amount
				? _amount
				: stakersInfo[_from].pendingStake;
			pendingStakes -= pendingToReduce;
			stakersInfo[_from].pendingStake -= pendingToReduce;
		}
	}

	// An inner function for withdrawal with validators interaction.
	function _withdraw(
		address _from,
		address _to,
		uint256 _amount
	) internal {
		uint256 effectiveBalance = address(this).balance;
		require(
			_amount > 0 && _amount <= _balanceOf(_from),
			"invalid withdraw amount"
		);

		// gather the requested FUSE from the validators equally.
		_gatherFuseFromValidators(_amount);
		effectiveBalance = address(this).balance - effectiveBalance; //use only undelegated funds

		// in case some funds were not withdrawn
		if (_amount > effectiveBalance) {
			_amount = effectiveBalance;
		}

		_withdraw(_from, _amount);

		if (_to != address(0)) {
			payable(_to).transfer(_amount);
			emit Withdrawn(_to, _amount, lastEpochIndex);
		}
	}

	/**
	 * @dev This function allows guardian to channel the funds of the community pool.
	 * @param _to An address of the specific user who should receiver the community pool.
	 */
	function acquireCommunityPoolBalance(address _to)
		external
		onlyRole(GUARDIAN_ROLE)
	{
		require(goodDollar.transfer(_to, communityPoolBalance));
	}

	// An inner function which calculates an amount of days of how many the method
	// collectUBIInterest was called.
	function _checkIfCalledOnceInDayAndReturnDay() internal returns (uint256) {
		uint256 curDay = ubiScheme.currentDay();
		require(curDay != lastDayCollected, "can collect only once in a ubi cycle");
		lastDayCollected = curDay;
		return curDay;
	}

	// Gather the amount for FUSE accepting faucets that they are required to recieve.
	function _getAmountOfFuseForAllFaucets() internal view returns(uint256 sum) {
		address[] memory fuseAcceptingFaucets = spendingRateOracle.getFaucetsThatAcceptFuse();
		for (uint256 i = 0; i < fuseAcceptingFaucets.length; i++) {
			sum += spendingRateOracle.getFaucetRequestedAmountInFuse(fuseAcceptingFaucets[i]);
		}
	}

	// An inner function which allows us to distribute totalAmount of GoodDollars to the
	// GD accepting faucets. Basically it iterates over all of the faucets accepting GD,
	// sending them the needed sum and querying the oracle to calculate the spending rate for him.
	function _distributeGDToFaucets(uint256 totalAmount) internal {
		address[] memory gdAcceptingFaucets = spendingRateOracle.getFaucetsThatAcceptGoodDollar();
		for (uint256 i = 0; i < gdAcceptingFaucets.length; i++) {
			uint256 targetAmount = spendingRateOracle.getFaucetRequestedAmountInGoodDollar(gdAcceptingFaucets[i]);
			if (!goodDollar.transfer(gdAcceptingFaucets[i], targetAmount) || totalAmount < targetAmount) {
				continue;
			} else {
				totalAmount -= targetAmount;
			}
			spendingRateOracle.queryBalance(
				gdAcceptingFaucets[i],
				goodDollar.balanceOf(gdAcceptingFaucets[i]),
				true
			);
		}
	}

	// An inner function which allows us to distribute totalAmount of FUSE to the
	// FUSE accepting faucets. Basically it iterates over all of the faucets accepting FUSE,
	// sending them the needed sum and querying the oracle to calculate the spending rate for him.
	function _distributeFuseToFaucets(uint256 totalAmount) internal {
		address[] memory fuseAcceptingFaucets = spendingRateOracle.getFaucetsThatAcceptFuse();
		for (uint256 i = 0; i < fuseAcceptingFaucets.length; i++) {
			uint256 targetAmount = spendingRateOracle.getFaucetRequestedAmountInFuse(fuseAcceptingFaucets[i]);
			if (!payable(fuseAcceptingFaucets[i]).send(targetAmount) || totalAmount < targetAmount) {
				continue;
			} else {
				totalAmount -= targetAmount;
			}
			spendingRateOracle.queryBalance(
				fuseAcceptingFaucets[i],
				fuseAcceptingFaucets[i].balance,
				false
			);
		}
	}

	/**
	 * @dev This function allows anyone to force calculation of their UBI in GoodDollars.
	 */
	function collectUBIInterest() external {
		// getting currend day number to pass in the event
		uint256 currentDayNumber = _checkIfCalledOnceInDayAndReturnDay();

		// reducing the precision to calculate new values
		debtToStakers /= PRECISION;
		debtToDAO /= PRECISION;

		// gather the FUSE amount for all FUSE accepting faucets
		uint256 totalAmountOfFuseForFuseAcceptingFaucets = _getAmountOfFuseForAllFaucets();

		// calculate total earnings of the funds that were staked
		uint256 earnings = _balance() - debtToStakers - debtToDAO;

		// calculate the keeper part from the earnings
		uint256 keeperPartInFuse = earnings * keeperRatio / RATIO_BASE;

		// subtract the keeper part from the earnings
		earnings -= keeperPartInFuse;

		// calculate the part of the FUSE that must be swapped to the GD and
		// distributed to the stakers
		uint256 stakersPartInFuse = earnings * globalGivebackRatio /
			RATIO_BASE + debtToStakers;

		// calculate the the part of the earnings that should be distributed to the
		// faucets and community pool
		uint256 daoPartInFuse = earnings - stakersPartInFuse + debtToDAO;

		// making sure that either faucets will receive their part
		totalAmountOfFuseForFuseAcceptingFaucets = Math.min(
			totalAmountOfFuseForFuseAcceptingFaucets,
			daoPartInFuse
		);

		// substracting the amount of FUSE from DAO part that should be distributed
		// to the faucets that accept FUSE
		daoPartInFuse -= totalAmountOfFuseForFuseAcceptingFaucets;

		// calculate the total sum to be swapped to GD
		uint256 totalFuseToSwap = stakersPartInFuse + daoPartInFuse;

		// the swap info - index 0 is the amount of FUSE that was spent
		// index 1 - the accepted amount of GD
		uint256[] memory buyResult = _buyGD(totalFuseToSwap);

		// the DAO part in GD
		uint256 daoPartInGoodDollar = buyResult[1] * PRECISION * daoPartInFuse
			/ totalFuseToSwap;

		// the community pool part in GD
		uint256 communityPoolPartInGoodDollar = daoPartInGoodDollar
			* communityPoolRatio
			/ RATIO_BASE;

		// the part that should go to the UBIScheme contract, basically the
		// remainings of the DAO part without community pool part
		uint256 ubiPartInGoodDollar = daoPartInGoodDollar - communityPoolPartInGoodDollar;

		// calculating the debt in FUSE that was now swapped according to the
		// market situation at the pair
		{
			uint256 totalDebt = totalFuseToSwap - buyResult[0];
			debtToStakers = totalDebt * PRECISION * stakersPartInFuse / totalFuseToSwap;
			debtToDAO = totalDebt * PRECISION * daoPartInFuse / totalFuseToSwap;
		}

		// performing the update of all giveback statistics
		_updateGlobalGivebackRatio();

		// distributing the GD to the faucets that accept GD (taking into account
	  // the UBIScheme part that should not be included)
		_distributeGDToFaucets(daoPartInGoodDollar - ubiPartInGoodDollar);

		// distributing the FUSE tokens to the FUSE accepting faucets
		_distributeFuseToFaucets(totalAmountOfFuseForFuseAcceptingFaucets);

		// updating the community pool balance
		communityPoolBalance += communityPoolPartInGoodDollar;

		// calculating and distributing the part for stakers
		{
			uint256 stakersPartInGoodDollar = buyResult[1] * PRECISION * stakersPartInFuse / totalFuseToSwap;
			_notifyRewardAmount(stakersPartInGoodDollar);
		}

		// making all the necessary transfers
		payable(msg.sender).transfer(keeperPartInFuse);

		require(
			goodDollar.transfer(address(ubiScheme), ubiPartInGoodDollar),
			"ubiPartTransferFailed"
		);

		emit UBICollected(
			currentDayNumber,
			ubiPartInGoodDollar,
			communityPoolPartInGoodDollar,
			buyResult[1],
			earnings,
			debtToStakers + debtToDAO,
			msg.sender,
			keeperPartInFuse
		);

	}

	/**
	 * @dev This function allows guardian to add the validator for the funds staking.
	 * @param _validator An address of the specific validator that should be utilized as
	 * staking validator for the acquiring funds of the users.
	 */
	function addValidator(address _validator) external onlyRole(GUARDIAN_ROLE) {
		_addValidator(_validator);
	}

	/**
	 * @dev This function allows guardian to remove the validator from list of valid validators.
	 * @param _validator An address of the specific validator that should be removed.
	 */
	function removeValidator(address _validator)
		external
		onlyRole(GUARDIAN_ROLE)
	{
		_removeValidator(_validator);
	}

	/**
	 * @dev This function allows anyone acquire their earned reward.
	 */
	function getReward() public nonReentrant updateReward(msg.sender) {
		uint256 reward = _getReward(msg.sender);
		IERC20(_rewardsToken).safeTransfer(msg.sender, reward);
	}

	function exit() external {
		withdraw(stakersInfo[msg.sender].balance);
		getReward();
	}

	// a classic ERC20 method to transfer LP tokens
	function transfer(address _to, uint256 _amount) external returns (bool) {
		_transfer(msg.sender, _to, _amount);
	}

	// a classic ERC20 method to approve LP tokens
	function approve(address _spender, uint256 _amount) external returns (bool) {
		_approve(msg.sender, _spender, _amount);
		return true;
	}

	function _approve(
		address _owner,
		address _spender,
		uint256 _amount
	) internal {
		require(
			_owner != address(0),
			"FuseStaking: approve from the zero address"
		);
		require(
			_spender != address(0),
			"FuseStaking: approve to the zero address"
		);
		allowance[_owner][_spender] = _amount;
		emit Approval(_owner, _spender, _amount);
	}

	// a classic ERC20 method to transfer from someone to someone on behalf of the
	// holder of LP tokens
	function transferFrom(
		address _from,
		address _to,
		uint256 _amount
	) public returns (bool) {
		address spender = _msgSender();
		_spendAllowance(_from, spender, _amount);
		_transfer(_from, _to, _amount);
		return true;
	}

	function _transfer(
		address _from,
		address _to,
		uint256 _amount
	) internal virtual {
		_withdraw(_from, address(0), _amount);
		uint256 givebackRatio = _getTransferGivebackRatio(_to, _from);
		_stake(_to, address(0), _amount, givebackRatio);
	}

	/**
	 * @dev determines the giveback ratio of a transferred stake
	 * @param _to the receiver
	 * @param _from the sender
	 * @return receiver average giveback ratio if he has one, otherwise sender giveback ratio
	 */
	function _getTransferGivebackRatio(address _to, address _from)
		internal
		view
		returns (uint256)
	{
		return
			giveBackRatioPerUser[_to] > 0
				? giveBackRatioPerUser[_to]
				: giveBackRatioPerUser[_from] > 0
				? giveBackRatioPerUser[_from]
				: minGivebackRatio;
	}

	function _spendAllowance(
		address _owner,
		address _spender,
		uint256 _amount
	) internal virtual {
		uint256 currentAllowance = allowance[_owner][_spender];
		if (currentAllowance != type(uint256).max) {
			require(currentAllowance >= _amount, "insufficient allowance");
			unchecked {
				_approve(_owner, _spender, currentAllowance - _amount);
			}
		}
	}
}
