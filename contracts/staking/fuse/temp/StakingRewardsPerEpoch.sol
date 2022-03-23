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

  mapping (address => StakeInfoPerEpoch) public stakersInfoPerEpoch;

  constructor(
      address _rewardsToken,
      address _stakingToken
  ) StakingRewards(_rewardsToken, _stakingToken) {}

  function _stake(address _from, uint256 _amount) internal override {
    pendingStakes += _amount;
    stakersInfoPerEpoch[_from].pendingStake += _amount;
    stakingToken.safeTransferFrom(_from, address(this), _amount);
    emit PendingStaked(_from, _amount);
  }

  function _withdraw(address _from, uint256 _amount) internal override {
    pendingStakes -= _amount;
    stakersInfoPerEpoch[_from].pendingStake -= _amount;
    stakingToken.safeTransfer(_from, _amount);
    emit PendingWithdrawn(_from, _amount);
  }

  function notifyRewardAmount(uint256 reward) external virtual onlyRole(GUARDIAN_ROLE) updateReward(address(0)) {
      if (block.timestamp >= periodFinish) {
          rewardRate = reward / rewardsDuration;
      } else {
          uint256 remaining = periodFinish - block.timestamp;
          uint256 leftover = remaining * rewardRate;
          rewardRate = (reward + leftover) / rewardsDuration;
      }

      // Ensure the provided reward amount is not more than the balance in the contract.
      // This keeps the reward rate in the right range, preventing overflows due to
      // very high values of rewardRate in the earned and rewardsPerToken functions;
      // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
      uint balance = rewardsToken.balanceOf(address(this));
      require(rewardRate <= balance / rewardsDuration, "Provided reward too high");

      lastUpdateTime = block.timestamp;
      periodFinish = block.timestamp + rewardsDuration;
      emit RewardAdded(reward);
  }

  event PendingStaked(address indexed user, uint256 amount);
  event PendingWithdrawn(address indexed user, uint256 amount);

}
