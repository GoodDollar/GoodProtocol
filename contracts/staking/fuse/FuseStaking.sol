// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./utils/StakingRewardsPerEpoch.sol";
import "./utils/GoodDollarSwaps.sol";
import "./utils/ValidatorsManagement.sol";
import "./IConsensus.sol";
import "./ISpendingRateOracle.sol";

contract FuseStaking is
	StakingRewardsPerEpoch,
	GoodDollarSwaps,
	ValidatorsManagement
{
	using SafeERC20 for IERC20;

	IUBIScheme public ubiScheme;

	uint256 public keeperRatio;
	uint256 public communityPoolRatio;
	uint256 public communityPoolBalance;

	uint256 public minGivebackRatio;
	uint256 public globalGivebackRatio;
	uint256 public pendingGivebackRatio;
	mapping(address => uint256) public giveBackRatioPerUser;

	ISpendingRateOracle public spendingRateOracle;
	uint256 public lastDayCollected; //ubi day from ubischeme
	mapping(address => mapping(address => uint256)) public allowance;

	event UBICollected(
		uint256 indexed currentDay,
		uint256 ubiAmount, //G$ sent to ubischeme
		uint256 communityPoolAmount, //G$ added to pool
		uint256 gdBoughtAmount, //actual G$ we got out of swapping stakingRewards + pendingFuseEarnings
		uint256 stakingRewardsAmount, //rewards earned since previous collection,
		uint256 pendingFuseEarnings, //new balance of fuse pending to be swapped for G$
		address keeper,
		uint256 keeperGDFee
	);
	event Transfer(address indexed from, address indexed to, uint256 value);
	event Approval(address indexed owner, address indexed spender, uint256 value);

	constructor(address _rewardsToken, address _stakingToken)
		StakingRewardsPerEpoch(_rewardsToken, _stakingToken)
	{}

	function stake(uint256 _giveBackRatio) public payable {
		stake(address(0), _giveBackRatio);
	}

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

	function _stake(address _from, uint256 _amount) internal override {
		pendingStakes += _amount;
		stakersInfo[_from].pendingStake += _amount;
		stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		emit Staked(_from, _amount);
	}

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
		emit Staked(_from, _amount);
	}

	function _updateGiveBackRatiosAndStake(
		address _from,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		_updateGivebackRatioForStakerAndPending(_from, _amount, _giveBackRatio);
		_stake(_from, _amount);
	}

	function _updateGivebackRatioForStakerAndPending(
		address _from,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		giveBackRatioPerUser[_from] = _weightedAverage(
			giveBackRatioPerUser[_from],
			stakersInfo[_from].balance,
			_giveBackRatio,
			_amount
		);
		pendingGivebackRatio = _weightedAverage(
			pendingGivebackRatio,
			pendingStakes,
			_giveBackRatio,
			_amount
		);
	}

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

	function withdraw(uint256 amount) public nonReentrant {
		require(amount > 0, "cannotWithdraw0");
		_withdraw(msg.sender, msg.sender, amount);
	}

	function _withdraw(address _from, uint256 _amount) internal override {
		if (stakersInfo[_from].pendingStake > 0) {
			uint256 pendingToReduce = stakersInfo[_from].pendingStake >= _amount
				? _amount
				: stakersInfo[_from].pendingStake;
			pendingStakes -= pendingToReduce;
			stakersInfo[_from].pendingStake -= pendingToReduce;
		}
	}

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
		_gatherFuseFromValidators(_amount);
		effectiveBalance = address(this).balance - effectiveBalance; //use only undelegated funds

		// in case some funds were not withdrawn
		if (_amount > effectiveBalance) {
			_amount = effectiveBalance;
		}

		_withdraw(_from, _amount);

		if (_to != address(0)) {
			payable(_to).transfer(_amount);
			emit Withdrawn(_to, _amount);
		}
	}

	function acquireCommunityPoolBalance(address _to)
		external
		onlyRole(GUARDIAN_ROLE)
	{
		require(goodDollar.transfer(_to, communityPoolBalance));
	}

	function _checkIfCalledOnceInDayAndReturnDay() internal returns (uint256) {
		uint256 curDay = ubiScheme.currentDay();
		require(curDay != lastDayCollected, "can collect only once in a ubi cycle");
		lastDayCollected = curDay;
		return curDay;
	}

	uint256 public debtToStakers;
	uint256 public debtToDAO;

	function _getAmountOfFuseForAllFaucets() internal view returns(uint256 sum) {
		address[] memory fuseAcceptingFaucets = spendingRateOracle.getFaucetsThatAcceptFuse();
		for (uint256 i = 0; i < fuseAcceptingFaucets.length; i++) {
			sum += spendingRateOracle.getFaucetRequestedAmountInFuse(fuseAcceptingFaucets[i]);
		}
	}

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

	function collectUBIInterest() external {
		uint256 currentDayNumber = _checkIfCalledOnceInDayAndReturnDay();

		debtToStakers /= PRECISION;
		debtToDAO /= PRECISION;

		uint256 earnings = _balance() - debtToStakers - debtToDAO;
		uint256 stakersPartInFuse = (earnings * (RATIO_BASE - globalGivebackRatio)) /
			RATIO_BASE + debtToStakers;
		uint256 daoPartInFuse = earnings - stakersPartInFuse + debtToDAO;

		uint256 totalAmountOfFuseForFuseAcceptingFaucets = _getAmountOfFuseForAllFaucets();
		uint256 totalFuseToSwap = stakersPartInFuse
			+ daoPartInFuse - totalAmountOfFuseForFuseAcceptingFaucets;

		uint256[] memory buyResult = _safeBuyGD(
			totalFuseToSwap,
			keccak256("totalFuseToSwap")
		);

		debtToStakers = buyResult[2] * PRECISION * stakersPartInFuse / totalFuseToSwap;
		debtToDAO = buyResult[2] * PRECISION * daoPartInFuse / totalFuseToSwap;

		uint256 stakersPartInGoodDollar = buyResult[1] * (RATIO_BASE - globalGivebackRatio)
			/ RATIO_BASE;

		uint256 daoPartInGoodDollar = buyResult[1] - stakersPartInGoodDollar;

		uint256 keeperPartInGoodDollar = daoPartInGoodDollar
			- (daoPartInGoodDollar * (RATIO_BASE - keeperRatio)) / RATIO_BASE;

		daoPartInGoodDollar -= keeperPartInGoodDollar;

		uint256 communityPoolPartInGoodDollar = daoPartInGoodDollar
			- (daoPartInGoodDollar * (RATIO_BASE - communityPoolRatio))
			/ RATIO_BASE;

		daoPartInGoodDollar -= communityPoolPartInGoodDollar;

		require(
			goodDollar.transfer(address(ubiScheme), keeperPartInGoodDollar),
			"ubiPartTransferFailed"
		);
		communityPoolBalance += communityPoolPartInGoodDollar;

		_distributeGDToFaucets(daoPartInGoodDollar);
		_distributeFuseToFaucets(totalAmountOfFuseForFuseAcceptingFaucets);

		_updateGlobalGivebackRatio();
		_notifyRewardAmount(stakersPartInGoodDollar);

		emit UBICollected(
			currentDayNumber,
			keeperPartInGoodDollar,
			communityPoolPartInGoodDollar,
			buyResult[1],
			earnings,
			buyResult[2],
			msg.sender,
			keeperPartInGoodDollar
		);
	}

	function addValidator(address _validator) external onlyRole(GUARDIAN_ROLE) {
		_addValidator(_validator);
	}

	function removeValidator(address _validator)
		external
		onlyRole(GUARDIAN_ROLE)
	{
		_removeValidator(_validator);
	}

	function getReward() public nonReentrant updateReward(msg.sender) {
		_getReward(msg.sender);
	}

	function exit() external {
		withdraw(stakersInfo[msg.sender].balance);
		getReward();
	}

	function transfer(address _to, uint256 _amount) external returns (bool) {
		_transfer(msg.sender, _to, _amount);
	}

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
