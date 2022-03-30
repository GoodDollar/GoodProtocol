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

	function withdraw(uint256 amount) 
  public 
  nonReentrant 
  {
		require(amount > 0, "cannotWithdraw0");
		_withdraw(msg.sender, amount, true);
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
		uint256 _amount,
		bool enableTransfer
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

		if (enableTransfer) {
			payable(_from).transfer(_amount);
			emit Withdrawn(_from, _amount);
		}
	}

	function acquireCommunityPoolBalance(address to)
		external
		onlyRole(GUARDIAN_ROLE)
	{
		require(goodDollar.transfer(to, communityPoolBalance));
	}

	function _distributeToUBIAndCommunityPool(
		uint256 _ubiAmount,
		uint256 _communityPoolAmount
	) internal returns (uint256 _gdUBIAmount, uint256 _gdCommunityPoolAmount) {
		if (_ubiAmount == 0 || _communityPoolAmount == 0) return;
		uint256[] memory swapResult = _buyGD(_ubiAmount);
		require(
			goodDollar.transfer(address(ubiScheme), swapResult[1]),
			"ubiPartTransferFailed"
		);
		_gdUBIAmount = swapResult[1];
		swapResult = _buyGD(_communityPoolAmount);
		communityPoolBalance += swapResult[1];
		_gdCommunityPoolAmount = swapResult[1];
	}

	function _distributeGivebackAndQueryOracle(uint256 _amount) internal virtual {
		if (_amount == 0) return;
		address[] memory faucetAddresses = spendingRateOracle.getFaucets();
		for (uint256 i = 0; i < faucetAddresses.length; i++) {
			address faucetToken = spendingRateOracle.getFaucetTokenAddress(
				faucetAddresses[i]
			);
			uint256 targetBalance = spendingRateOracle.getFaucetTargetBalance(
				faucetAddresses[i]
			);
			uint256 balancesDifference;
			if (faucetToken == address(0)) {
				if (faucetToken.balance < targetBalance) {
					balancesDifference = targetBalance - faucetToken.balance;
					_amount -= balancesDifference;
					require(
						payable(faucetAddresses[i]).transfer(balancesDifference),
						"transferToFaucetFailed"
					);
					spendingRateOracle.queryBalance(
						faucetAddresses[i],
						faucetAddresses[i].balance,
						address(0)
					);
				}
			} else {
				IERC20 faucetTokenInstance = IERC20(faucetToken);
				uint256 actualBalance = faucetTokenInstance.balanceOf(
					faucetAddresses[i]
				);
				if (actualBalance < targetBalance) {
					balancesDifference = targetBalance - actualBalance;
					_amount -= balancesDifference;
					uint256[] memory swapResult = _buyGD(balancesDifference);
					faucetTokenInstance.safeTransfer(faucetAddresses[i], swapResult[1]);
					spendingRateOracle.queryBalance(
						faucetAddresses[i],
						faucetTokenInstance.balanceOf(faucetAddresses[i]),
						faucetToken
					);
				}
			}
		}
	}

	function _checkIfCalledOnceInDayAndReturnDay() internal returns (uint256) {
		uint256 curDay = ubiScheme.currentDay();
		require(
      curDay != lastDayCollected, 
      "can collect only once in a ubi cycle"
      );
		lastDayCollected = curDay;
		return curDay;
	}

	function collectUBIInterest() external onlyRole(GUARDIAN_ROLE) {
		uint256 curDay = _checkIfCalledOnceInDayAndReturnDay();
		uint256 earnings = _balance(); // pending fuse earnings?

		uint256 fuseAmountForUBI = (earnings * (RATIO_BASE - globalGivebackRatio)) /
			RATIO_BASE;

		uint256 givebackAmount = earnings > 0 ? earnings - fuseAmountForUBI : 0;
		uint256 keeperAmount = fuseAmountForUBI > 0
			? fuseAmountForUBI -
				(fuseAmountForUBI * (RATIO_BASE - keeperRatio)) /
				RATIO_BASE
			: 0;
		uint256 communityPoolAmount = keeperAmount > 0
			? keeperAmount - (keeperAmount * communityPoolRatio) / RATIO_BASE
			: 0;

		_distributeGivebackAndQueryOracle(givebackAmount);
		(
			uint256 gdUBIAmount,
			uint256 gdCommunityPoolAmount
		) = _distributeToUBIAndCommunityPool(keeperAmount, communityPoolAmount);
		uint256[] memory swapResult = _buyGD(fuseAmountForUBI);
		_notifyRewardAmount(swapResult[1]);
		_updateGlobalGivebackRatio();

		// emit UBICollected(
		// 	curDay,
		// 	gdUBIAmount,
		// 	gdCommunityPoolAmount,
		// 	swapResult[1],
		// 	earnings,
		// 	// pendingFuseEarnings, // ??
		// 	msg.sender,
		// 	keeperAmount
		// );
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
}
