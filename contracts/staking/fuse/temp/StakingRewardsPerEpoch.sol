// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./StakingRewards.sol";

contract StakingRewardsPerEpoch is StakingRewardsPerEpoch {


  struct StakeInfoPerEpoch {
    uint256 pendingStakes;
    uint256 giveBackRatio;
    uint256 indexOfLastEpochStaked;
  }

  uint256 public lastCollectUBIInterestIndex;

  mapping (address => StakeInfoPerEpoch) public stakersInfoPerEpoch;

  function notifyRewardAmount(uint256 reward) external override onlyRole(GUARDIAN_ROLE) updateReward(address(0)) {
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
}
