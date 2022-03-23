// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./StakingRewards.sol";

contract StakingRewardsPerEpoch is StakingRewards {

  struct StakeInfoPerEpoch {
    uint256 pendingStake;
    uint256 giveBackRatio;
    uint256 indexOfLastEpochStaked;
  }

  uint256 public lastEpochIndex;
  uint256 public pendingStakes;

  uint256[] public rewardsPerTokenAt;

  mapping (address => StakeInfoPerEpoch) public stakersInfoPerEpoch;

  constructor(
      address _rewardsToken,
      address _stakingToken
  ) StakingRewards(_rewardsToken, _stakingToken) {}

  function _stake(address _from, uint256 _amount) internal override {
    pendingStakes += _amount;
    stakersInfoPerEpoch[_from].pendingStake += _amount;
    stakingToken.safeTransferFrom(_from, address(this), _amount);
    stakersInfoPerEpoch[_from].indexOfLastEpochStaked = lastEpochIndex;
    emit PendingStaked(_from, _amount);
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

  function earned(address account) public virtual view returns (uint256) {
      return stakersInfo[account].balance * (rewardPerToken() - stakersInfo[account].rewardPerTokenPaid) / PRECISION + stakersInfo[account].reward;
  }

  function notifyRewardAmount(uint256 reward) public override onlyRole(GUARDIAN_ROLE) updateReward(address(0)) {
    super.notifyRewardAmount(reward);
    lastEpochIndex++;
  }

  event PendingStaked(address indexed user, uint256 amount);
  event PendingWithdrawn(address indexed user, uint256 amount);

}
