// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./StakingRewards.sol";
import "./GoodDollarSwaps.sol";
import "./IConsensus.sol";

contract StakingRewardsPerEpoch is StakingRewards, GoodDollarSwaps {
  using SafeERC20 for IERC20;

  struct StakeInfoPerEpoch {
    uint256 pendingStake;
    uint256 giveBackRatio;
    uint256 indexOfLastEpochStaked;
  }

  mapping (address => StakeInfoPerEpoch) public stakersInfoPerEpoch;

  uint256 public constant RATIO_BASE = 10000;

  address[] public validators;

  IConsensus public consensus;

  Uniswap public uniswapV2Router;
  IGoodDollar public goodDollar;
  IUBIScheme public ubiScheme;
  UniswapFactory public uniswapFactory;
  UniswapPair public uniswapGoodDollarFusePair;

  uint256 public maxSlippageRatio; //actually its max price impact ratio

  uint256 public keeperAndCommunityPoolRatio;
  uint256 public communityPoolBalance;

	uint256 public minGivebackRatio;
	uint256 public globalGivebackRatio;

  uint256 public lastEpochIndex;
  uint256 public pendingStakes;

  uint256[] public rewardsPerTokenAt;

  constructor(
      address _rewardsToken,
      address _stakingToken,
      uint256 _minGivebackRatio
  ) StakingRewards(_rewardsToken, _stakingToken) {
    minGivebackRatio = _minGivebackRatio;
  }

  function _stake(address _from, uint256 _amount, uint256 _giveBackRatio) internal override {
    _updateStakerBalanceAndGiveback(_from, _amount, _giveBackRatio);
    pendingStakes += _amount;
    stakersInfoPerEpoch[_from].pendingStake += _amount;
    stakingToken.safeTransferFrom(_from, address(this), _amount);
    stakersInfoPerEpoch[_from].indexOfLastEpochStaked = lastEpochIndex;
    emit PendingStaked(_from, _amount);
  }

  function _updateStakerGivebackRatio(
      address _to,
      uint256 _amount,
      uint256 _giveBackRatio
  ) internal {
    stakersInfoPerEpoch[_to].giveBackRatio = weightedAverage(
        stakersInfoPerEpoch[_to].giveBackRatio,
        stakersInfo[_to].balance,
        _giveBackRatio,
        _amount
    );
  }
  
  function _updateGlobalGivebackRatio() internal {    
    // globalGivebackRatio = weightedAverage(
    //     globalGivebackRatio,
    //     pendingStakes,
    //     _giveBackRatio,
    //     _amount
    // );
  }

  function _withdraw(address _from, uint256 _amount) internal override {
    pendingStakes -= _amount;
    stakersInfoPerEpoch[_from].pendingStake -= _amount;
    if (stakersInfoPerEpoch[_from].pendingStake == 0) {
      stakersInfoPerEpoch[_from].indexOfLastEpochStaked = 0;
    }
    stakingToken.safeTransfer(_from, _amount);
    emit PendingWithdrawn(_from, _amount);
  }

  function _getRewardPerTokenPerUser(address _account) internal view returns(uint256) {
    return rewardsPerTokenAt[lastEpochIndex] - rewardsPerTokenAt[stakersInfoPerEpoch[_account].indexOfLastEpochStaked];
  }

  function earned(address account) public override view returns (uint256) {
      return stakersInfo[account].balance * (_getRewardPerTokenPerUser(account) - stakersInfo[account].rewardPerTokenPaid) / PRECISION + stakersInfo[account].reward;
  }

  function _updateReward(address _account) internal override {
    lastUpdateTime = lastTimeRewardApplicable();
    if (_account != address(0)) {
        stakersInfo[_account].balance += stakersInfoPerEpoch[_from].pendingStake;
        stakersInfoPerEpoch[_from].pendingStake = 0;
        stakersInfo[_account].reward = earned(_account);
        stakersInfo[_account].rewardPerTokenPaid = _getRewardPerTokenPerUser(_account);
    }
  }

  function notifyRewardAmount(uint256 reward) external override onlyRole(GUARDIAN_ROLE) updateReward(address(0)) {
    _totalSupply += pendingStakes;
    rewardsPerTokenAt.push(rewardPerToken());
    _notifyRewardAmount(reward);
    lastEpochIndex++;
  }

  function _gatherFuseFromValidators(uint256 _value) internal {
		uint256 toCollect = _value;
		uint256 perValidator = _value / validators.length;
		for (uint256 i = 0; i < validators.length; i++) {
			uint256 cur = consensus.delegatedAmount(
				address(this),
				validators[i]
			);
			if (cur == 0) continue;
			if (cur <= perValidator) {
				_safeUndelegate(validators[i], cur);
				toCollect = toCollect - cur;
			} else {
				_safeUndelegate(validators[i], perValidator);
				toCollect = toCollect - perValidator;
			}
			if (toCollect == 0) break;
		}
	}

  function _stakeNextValidator(uint256 _value, address _validator)
		internal
		returns (bool)
	{
		if (validators.length == 0) return false;
		if (_validator != address(0)) {
			consensus.delegate{ value: _value }(_validator);
			return true;
		}

		uint256 perValidator = (totalDelegated() + _value) / validators.length;
		uint256 left = _value;
		for (uint256 i = 0; i < validators.length && left > 0; i++) {
			uint256 cur = consensus.delegatedAmount(
				address(this),
				validators[i]
			);

			if (cur < perValidator) {
				uint256 toDelegate = perValidator - cur;
				toDelegate = toDelegate < left ? toDelegate : left;
				consensus.delegate{ value: toDelegate }(validators[i]);
				left = left - toDelegate;
			}
		}

		return true;
	}

  function totalDelegated() external view returns (uint256) {
    uint256 total = 0;
    for (uint256 i = 0; i < validators.length; i++) {
      uint256 cur = consensus.delegatedAmount(
        address(this),
        validators[i]
      );
      total += cur;
    }
    return total;
  }

  function _safeUndelegate(address _validator, uint256 _amount)
    internal
    returns (bool)
  {
    try consensus.withdraw(_validator, _amount) {
      return true;
    } catch Error(
      string memory /*reason*/
    ) {
      // This is executed in case
      // revert was called inside getData
      // and a reason string was provided.
      return false;
    } catch (
      bytes memory /*lowLevelData*/
    ) {
      // This is executed in case revert() was used
      // or there was a failing assertion, division
      // by zero, etc. inside getData.
      return false;
    }
  }

  receive() external payable {}

  event PendingStaked(address indexed user, uint256 amount);
  event PendingWithdrawn(address indexed user, uint256 amount);

}
