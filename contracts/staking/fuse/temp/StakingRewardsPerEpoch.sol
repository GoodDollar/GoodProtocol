// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./StakingRewards.sol";
import "./GoodDollarSwaps.sol";
import "./IConsensus.sol";
import "../ISpendingRateOracle.sol";
import "./ValidatorsManagement.sol";

contract StakingRewardsPerEpoch is StakingRewards, GoodDollarSwaps, ValidatorsManagement {
  using SafeERC20 for IERC20;

  struct StakeInfoPerEpoch {
    uint256 pendingStake;
    uint256 giveBackRatio;
    uint256 indexOfLastEpochStaked;
  }

  mapping (address => StakeInfoPerEpoch) public stakersInfoPerEpoch;

  uint256 public constant RATIO_BASE = 10000;

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
  uint256 public pendingGivebackRatio;

  ISpendingRateOracle public spendingRateOracle;

  uint256[] public rewardsPerTokenAt;

  constructor(
      address _rewardsToken,
      uint256 _minGivebackRatio
  ) StakingRewards(_rewardsToken, address(0)) {
    minGivebackRatio = _minGivebackRatio;
  }

  function _stake(address _from, uint256 _amount, uint256 _giveBackRatio) internal override {
    require(_amount == msg.value, "amountProvidedMustBeEqualToMsgValue");
    require(_giveBackRatio >= minGivebackRatio, "giveback should be higher or equal to minimum");
    require(_stakeNextValidator(_amount, address(0)), "stakeInConsensusIsNotPerformed");
    _updateStakerAndPendingGivebackRatio(_from, _amount, _giveBackRatio);
    pendingStakes += _amount;
    stakersInfoPerEpoch[_from].pendingStake += _amount;
    stakersInfoPerEpoch[_from].indexOfLastEpochStaked = lastEpochIndex; // should be + 1?
    emit PendingStaked(_from, _amount);
  }

  function _updateStakerAndPendingGivebackRatio(
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
        _totalSupply,
        pendingGivebackRatio,
        pendingStakes
    );
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
    stakersInfoPerEpoch[_from].pendingStake -= _amount;

    if (_amount > 0) {
			payable(_from).transfer(_amount);
		}
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
        stakersInfo[_account].reward = earned(_account);
        stakersInfo[_account].rewardPerTokenPaid = _getRewardPerTokenPerUser(_account);
    }
  }

  function happenOnNextCollectUbi() public {
    // todo: save which accounts have pending stakes this epoch and iterate only on them and not all
    stakersInfo[_account].balance += stakersInfoPerEpoch[_account].pendingStake; 
    stakersInfoPerEpoch[_account].pendingStake = 0;
  } 

  function notifyRewardAmount(uint256) external override onlyRole(GUARDIAN_ROLE) updateReward(address(0)) {
    _totalSupply += pendingStakes;
    rewardsPerTokenAt.push(rewardPerToken());
    lastEpochIndex++;
    // distribute DAO part
    // distribute community pool and UBI scheme
    // buy GD for stakers
    uint256 reward = 0; // bought GD
    _notifyRewardAmount(reward);
  }

  function addValidator(address _validator) external onlyRole(GUARDIAN_ROLE) {
    _addValidator(_validator);
	}

	function removeValidator(address _validator) external onlyRole(GUARDIAN_ROLE) {
    _removeValidator(_validator);
	}

  event PendingStaked(address indexed user, uint256 amount);
  event PendingWithdrawn(address indexed user, uint256 amount);
}
