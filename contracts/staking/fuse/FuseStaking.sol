// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./utils/StakingRewardsPerEpoch.sol";
// import "./utils/GoodDollarSwaps.sol";
// import "./utils/ValidatorsManagement.sol";
// import "./IConsensus.sol";
// import "./ISpendingRateOracle.sol";

contract FuseStaking is
	StakingRewardsPerEpoch //,
	// GoodDollarSwaps,
	// ValidatorsManagement
{
	// uint256 public keeperRatio;
	// uint256 public communityPoolRatio;
	// uint256 public communityPoolBalance;

	uint256 public minGivebackRatio;
	uint256 public globalGivebackRatio;
	uint256 public pendingGivebackRatio;
	mapping(address => uint256) public giveBackRatioPerUser;

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
		// stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		// emit Staked(_from, _amount);
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

	// function withdraw(uint256 amount) public nonReentrant {
	// 	require(amount > 0, "cannotWithdraw0");
	// 	_withdraw(msg.sender, amount, true);
	// }

	function _withdraw(address _from, uint256 _amount) internal override {
		if (stakersInfo[_from].pendingStake > 0) {
			uint256 pendingToReduce = stakersInfo[_from].pendingStake >= _amount
				? _amount
				: stakersInfo[_from].pendingStake;
			pendingStakes -= pendingToReduce;
			stakersInfo[_from].pendingStake -= pendingToReduce;
			stakersInfo[_from].balance -= _amount - pendingToReduce;
		} else {
			stakersInfo[_from].balance -= _amount;
		}
	}

	function _withdraw(
		address _from,
		uint256 _amount,
		bool enableTransfer
	) internal {
		// uint256 effectiveBalance = address(this).balance;
		// require(
		// 	_amount > 0 && _amount <= _balanceOf(_from),
		// 	"invalid withdraw amount"
		// );
		// _gatherFuseFromValidators(_amount);
		// effectiveBalance = address(this).balance - effectiveBalance; //use only undelegated funds

		// // in case some funds were not withdrawn
		// if (_amount > effectiveBalance) {
		// 	_amount = effectiveBalance;
		// }

		_withdraw(_from, _amount);

		// if (enableTransfer) {
		// 	payable(_from).transfer(_amount);
		// 	emit Withdrawn(_from, _amount);
		// }
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

	function transfer(address _to, uint256 _amount) external returns (bool) {
		_transfer(msg.sender, _to, _amount);
	}

	// function approve(address _spender, uint256 _amount) external returns (bool) {
	// 	_approve(msg.sender, _spender, _amount);
	// 	return true;
	// }

	// function _approve(
	// 	address _owner,
	// 	address _spender,
	// 	uint256 _amount
	// ) internal {
	// 	require(
	// 		_owner != address(0),
	// 		"FuseStakingV4: approve from the zero address"
	// 	);
	// 	require(
	// 		_spender != address(0),
	// 		"FuseStakingV4: approve to the zero address"
	// 	);
	// 	allowance[_owner][_spender] = _amount;
	// 	emit Approval(_owner, _spender, _amount);
	// }

	function transferFrom(
		address _from,
		address _to,
		uint256 _amount
	) public returns (bool) {
		// address spender = _msgSender();
		// _spendAllowance(_from, spender, _amount);
		_transfer(_from, _to, _amount);
		return true;
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

	// function _spendAllowance(
	// 	address _owner,
	// 	address _spender,
	// 	uint256 _amount
	// ) internal virtual {
	// 	uint256 currentAllowance = allowance[_owner][_spender];
	// 	if (currentAllowance != type(uint256).max) {
	// 		require(currentAllowance >= _amount, "insufficient allowance");
	// 		unchecked {
	// 			_approve(_owner, _spender, currentAllowance - _amount);
	// 		}
	// 	}
	// }
}
