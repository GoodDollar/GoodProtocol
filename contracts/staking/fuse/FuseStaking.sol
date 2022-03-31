// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

contract FuseStaking {
	uint256 public minGivebackRatio;
	uint256 public globalGivebackRatio;
	uint256 public pendingGivebackRatio;
	mapping(address => uint256) public giveBackRatioPerUser;

	struct StakerInfo {
		uint256 reward;
		uint256 balance;
		uint256 pendingStake;
		uint256 indexOfLastEpochStaked;
	}
	mapping(address => StakerInfo) public stakersInfo;

	uint256 public pendingStakes;
	uint256 public totalSupply;

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
		// require(msg.value > 0, "stake must be > 0");
		_stake(msg.sender, _validator, msg.value, _giveBackRatio);
	}

	function _stake(
		address _from,
		address _validator,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		// _requireValidValidator(_validator);
		require(
			_giveBackRatio >= minGivebackRatio,
			"giveback should be higher or equal to minimum"
		);
		// require(_stakeNextValidator(_amount, _validator), "stakeFailed");
		_updateGiveBackRatiosAndStake(_from, _amount, _giveBackRatio);
		// emit Staked(_from, _amount);
	}

	function _updateGiveBackRatiosAndStake(
		address _from,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		_updateGivebackRatioForStakerAndPending(_from, _amount, _giveBackRatio);
		// _stake(_from, _amount);
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

	function collectUBIInterest() external onlyRole(GUARDIAN_ROLE) {
		// uint256 curDay = _checkIfCalledOnceInDayAndReturnDay();
		// uint256 earnings = _balance(); // pending fuse earnings?

		// uint256 stakersPart = (earnings * (RATIO_BASE - globalGivebackRatio)) /
		// 	RATIO_BASE;
		// uint256 daoPart = earnings > 0 ? earnings - stakersPart : 0;
		// uint256 keeperPart;
		// uint256 communityPoolPart;

		// if (stakersPart > 0) {
		// 	keeperPart =
		// 		stakersPart -
		// 		(stakersPart * (RATIO_BASE - keeperRatio)) /
		// 		RATIO_BASE;
		// 	stakersPart -= keeperPart;
		// 	communityPoolPart =
		// 		stakersPart -
		// 		(stakersPart * (RATIO_BASE - communityPoolRatio)) /
		// 		RATIO_BASE;
		// 	stakersPart -= communityPoolPart;
		// }

		// _distributeGivebackAndQueryOracle(daoPart);
		// (
		// 	uint256 gdUBIAmount,
		// 	uint256 gdCommunityPoolAmount
		// ) = _distributeToUBIAndCommunityPool(keeperPart, communityPoolPart);
		// uint256[] memory swapResult = _buyGD(stakersPart);
		// _notifyRewardAmount(swapResult[1]);
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

	function _transfer(
		address _from,
		address _to,
		uint256 _amount
	) internal virtual {
		_withdraw(_from, address(this), false);
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
}
