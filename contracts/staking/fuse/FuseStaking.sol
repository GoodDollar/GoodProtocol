// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./utils/StakingRewardsPerEpoch.sol";
import "./utils/GoodDollarSwaps.sol";
import "./utils/ValidatorsManagement.sol";
import "./IConsensus.sol";
import "./ISpendingRateOracle.sol";

contract FuseStaking is StakingRewardsPerEpoch, GoodDollarSwaps, ValidatorsManagement {

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


  function stake(uint _giveBackRatio) public payable returns (bool) {
		return stake(address(0), _giveBackRatio);
	}

	function stake(address _validator, uint256 _giveBackRatio) public payable returns (bool) {
		require(msg.value > 0, "stake must be > 0");
		return _stake(msg.sender, _validator, msg.value, _giveBackRatio);
	}
  
  function _stake(address _from, uint256 _amount, uint256 _giveBackRatio) internal returns (bool) {
    return _stake(_from, address(0), _amount, _giveBackRatio);
  }

  function _stake(address _from, address _validator, uint256 _amount, uint256 _giveBackRatio) internal returns (bool) {
		require(_amount == msg.value, "amountProvidedMustBeEqualToMsgValue");
    require(validators.length > 0, "no approved validators");
		_requireValidValidator(_validator);
		require(_giveBackRatio >= minGivebackRatio, "giveback should be higher or equal to minimum");

    //require(_stakeNextValidator(_amount, _validator), "stakeInConsensusIsNotPerformed"); 
		bool staked = _stakeNextValidator(_amount, _validator); // require or bool?
		
    _updateGiveBackRatiosAndStake(_from, _amount, _giveBackRatio);
    emit Staked(_from, _amount);

    return staked;
	}

  function _requireValidValidator(address _validator) internal view {
		bool found;
		for (
			uint256 i = 0;
			_validator != address(0) && i < validators.length;
			i++
		) {
			if (validators[i] != _validator) {
				found = true;
				break;
			}
		}
		require(
			_validator == address(0) || found,
			"validator not in approved list"
		);
	}

  function _updateGiveBackRatiosAndStake(address _from, uint256 _amount, uint256 _giveBackRatio) internal {
    _updateStakerAndPendingGivebackRatio(_from, _amount, _giveBackRatio);
    super._stake(_from, _amount);
  }

  function _updateStakerAndPendingGivebackRatio(
      address _to,
      uint256 _amount,
      uint256 _giveBackRatio
  ) internal {
    giveBackRatioPerUser[_to] = weightedAverage(
        giveBackRatioPerUser[_to],
        stakersInfo[_to].balance,
        _giveBackRatio,
        _amount
    );
    pendingGivebackRatio = weightedAverage(
        pendingGivebackRatio,
        pendingStakes,
        _giveBackRatio,
        _amount
    );
  }

  function _updateGlobalGivebackRatio() internal {
    globalGivebackRatio = weightedAverage(
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
  function weightedAverage(
      uint256 valueA,
      uint256 weightA,
      uint256 valueB,
      uint256 weightB
  ) internal pure returns (uint256) {
			return (valueA * weightA + valueB * weightB) / (weightA + weightB);
  }

  function _withdraw(address _from, uint256 _amount) internal override {
    uint256 effectiveBalance = address(this).balance;

		_gatherFuseFromValidators(_amount);

		effectiveBalance = address(this).balance - effectiveBalance; //use only undelegated funds

    // in case some funds where not withdrawn
		if (_amount > effectiveBalance) {
			_amount = effectiveBalance;
		}

    pendingStakes -= _amount;
    stakersInfo[_from].pendingStake -= _amount;

    if (_amount > 0) {
			payable(_from).transfer(_amount);
		}
    emit Withdrawn(_from, _amount);
  }

  // function notifyRewardAmount(uint256) external override onlyRole(GUARDIAN_ROLE) updateReward(address(0)) {
  //   _totalSupply += pendingStakes;
  //   rewardsPerTokenAt.push(rewardPerToken());
  //   lastEpochIndex++;
  //   // distribute DAO part
  //   // distribute community pool and UBI scheme
  //   // buy GD for stakers
  //   uint256 reward = 0; // bought GD
  //   _notifyRewardAmount(reward);
  // }

  function addValidator(address _validator) external onlyRole(GUARDIAN_ROLE) {
    _addValidator(_validator);
	}

	function removeValidator(address _validator) external onlyRole(GUARDIAN_ROLE) {
    _removeValidator(_validator);
	}
}
