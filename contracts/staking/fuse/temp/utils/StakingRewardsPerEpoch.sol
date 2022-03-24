// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./StakingRewards.sol";
import "./GoodDollarSwaps.sol";
import "../IConsensus.sol";
import "../../ISpendingRateOracle.sol";
import "./ValidatorsManagement.sol";

contract StakingRewardsPerEpoch is StakingRewards {
  using SafeERC20 for IERC20;

  struct StakeInfoPerEpoch {
    uint256 pendingStake;
    uint256 indexOfLastEpochStaked;
  }

  mapping (address => StakeInfoPerEpoch) public stakersInfoPerEpoch;

  uint256 public lastEpochIndex;
  uint256 public pendingStakes;

  uint256[] public rewardsPerTokenAt;

  constructor(
      address _rewardsToken,
      address _stakingToken
  ) StakingRewards(_rewardsToken, _stakingToken) {}

  function _stake(address _from, uint256 _amount) internal virtual override {
    pendingStakes += _amount;
    stakersInfoPerEpoch[_from].pendingStake += _amount;
    stakersInfoPerEpoch[_from].indexOfLastEpochStaked = lastEpochIndex; // should be + 1?
    stakingToken.safeTransferFrom(_from, address(this), _amount);
    emit PendingStaked(_from, _amount);
  }

  function _withdraw(address _from, uint256 _amount) internal virtual override {
    pendingStakes -= _amount;
    stakersInfoPerEpoch[_from].pendingStake -= _amount;
    stakingToken.safeTransfer(_from, _amount);
    emit PendingWithdrawn(_from, _amount);
  }

  function _getRewardPerTokenPerUser(address _account) internal view returns(uint256) {
    return rewardsPerTokenAt[lastEpochIndex] - rewardsPerTokenAt[stakersInfoPerEpoch[_account].indexOfLastEpochStaked];
  }

  function earned(address account) public override view returns (uint256) {
      return stakersInfo[account].balance * (_getRewardPerTokenPerUser(account) - stakersInfo[account].rewardPerTokenPaid) / PRECISION + stakersInfo[account].reward;
  }

  function _updateReward(address _account) internal virtual override {
    lastUpdateTime = lastTimeRewardApplicable();
    if (_account != address(0)) {
        stakersInfo[_account].reward = earned(_account);
        stakersInfo[_account].rewardPerTokenPaid = _getRewardPerTokenPerUser(_account);
    }
  }

  function notifyRewardAmount(uint256 reward) external override onlyRole(GUARDIAN_ROLE) updateReward(address(0)) {
    _totalSupply += pendingStakes;
    rewardsPerTokenAt.push(rewardPerToken());
    lastEpochIndex++;
    _notifyRewardAmount(reward);
  }
  
  event PendingStaked(address indexed user, uint256 amount);
  event PendingWithdrawn(address indexed user, uint256 amount);
}
