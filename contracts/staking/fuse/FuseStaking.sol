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

	uint256 public keeperAndCommunityPoolRatio;
	uint256 public communityPoolBalance;

	uint256 public minGivebackRatio;
	uint256 public globalGivebackRatio;
	uint256 public pendingGivebackRatio;
	mapping(address => uint256) public giveBackRatioPerUser;

	ISpendingRateOracle public spendingRateOracle;

	constructor(address _rewardsToken, address _stakingToken)
		StakingRewardsPerEpoch(_rewardsToken, _stakingToken)
	{}

	function stake(uint256 _giveBackRatio) public payable returns (bool) {
		return stake(address(0), _giveBackRatio);
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

	function getReward() public nonReentrant updateReward(msg.sender) {
		_getReward(msg.sender);
	}

	function exit() external {
		withdraw(stakersInfo[msg.sender].balance);
		getReward();
	}

	function _stake(
		address _from,
		address _validator,
		uint256 _giveBackRatio
	) internal {
		_requireValidValidator(_validator);
		require(
			_giveBackRatio >= minGivebackRatio,
			"giveback should be higher or equal to minimum"
		);
		require(_stakeNextValidator(_amount, _validator), "stakeFailed");
		_updateStakerAndPendingGivebackRatio(_from, _amount, _giveBackRatio);
		_stake(_from, _amount);
		emit Staked(_from, _amount);
	}

	function _stake(address _from, uint256 _amount)
		internal
		override
	{
		pendingStakes += _amount;
		stakersInfo[_from].pendingStake += _amount;
		stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		emit Staked(_from, _amount);
	}

	function _updateStakerAndPendingGivebackRatio(
		address _to,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		giveBackRatioPerUser[_to] = _weightedAverage(
			giveBackRatioPerUser[_to],
			stakersInfo[_to].balance,
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

	function _withdraw(address _from, uint256 _amount, bool enableTransfer) internal override {
		uint256 effectiveBalance = address(this).balance;
		_gatherFuseFromValidators(_amount);
		effectiveBalance = address(this).balance - effectiveBalance; //use only undelegated funds

		// in case some funds where not withdrawn
		if (_amount > effectiveBalance) {
			_amount = effectiveBalance;
		}

		_withdraw(_from, _amount);

		if (enableTransfer) {
			payable(_from).transfer(_amount);
			emit Withdrawn(_from, _amount);
		}
	}

	function acquireCommunityPoolBalance(address to) external onlyRole(GUARDIAN_ROLE) {
		require(goodDollar.transfer(to, communityPoolBalance));
	}

	function _distributeToUBIAndCommunityPoolAndQueryOracle(uint256 _ubiAmount, uint256 _communityPoolAmount) internal {
		if (_ubiAmount == 0 || _communityPoolAmount == 0) return;
		communityPoolBalance += _communityPoolAmount;
		// buy gd for _ubiAmount
		uint256 ubiAmountInGD = 0;
		require(goodDollar.transfer(address(ubiScheme), ubiAmountInGD));
	}

	function _distributeGivebackAndQueryOracle(uint256 _amount) internal {
		if (_amount == 0) return;
		address[] memory faucetAddresses = spendingRateOracle.getFaucets();
		for (uint256 i = 0; i < faucetAddresses.length; i++) {
			address faucetToken = spendingRateOracle.getFaucetTokenAddress(faucetAddresses[i]);
			uint256 targetBalance = spendingRateOracle.getFaucetTargetBalance(faucetAddresses[i]);
			uint256 balancesDifference;
			if (faucetToken == address(0)) {
				if (faucetToken.balance < targetBalance) {
					balancesDifference = targetBalance - faucetToken.balance;
					if (_amount < balancesDifference) break;
					_amount -= balancesDifference;
					payable(faucetAddresses[i]).transfer(balancesDifference);
				}
			} else {
				uint256 actualBalance = IERC20(faucetToken).balanceOf(faucetAddresses[i]);
				if (actualBalance < targetBalance) {
					balancesDifference = targetBalance - actualBalance;
					if (_amount < balancesDifference) break;
					_amount -= balancesDifference;
					// todo buying GD
					IERC20(faucetToken).safeTransfer(faucetAddresses[i], balancesDifference);
				}
			}
		}
	}

	function collectUBIInterest() external onlyRole(GUARDIAN_ROLE) {
		uint256 curDay = _checkIfCalledOnceInDayAndReturnDay();

		uint256 contractBalance;
		uint256 earnings;
		if (_isEarningsCheckEnabled) {
			contractBalance = _balance();
			require(contractBalance > 0, "no earnings to collect");
			earnings = contractBalance - totalPendingStakes;
		}

		uint256 fuseAmountForUBI = (earnings * (RATIO_BASE - globalGivebackRatio)) / RATIO_BASE;

		uint256 givebackAmount = earnings > 0 ? earnings - fuseAmountForUBI : 0;
		uint256 keeperAmount = fuseAmountForUBI > 0 ? fuseAmountForUBI - (fuseAmountForUBI * (RATIO_BASE - keeperRatio)) / RATIO_BASE : 0;
		uint256 communityPoolAmount = keeperAmount > 0 ? keeperAmount - (keeperAmount * communityPoolRatio) / RATIO_BASE : 0;

		_distributeGivebackAndQueryOracle(givebackAmount);
		_distributeToUBIAndCommunityPoolAndQueryOracle(keeperAmount, communityPoolAmount);

		// split it
		// notify reward amount
		// distribute to faucets
		// distribute to communityPoolBalance
		// distribute to keeper
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
}
