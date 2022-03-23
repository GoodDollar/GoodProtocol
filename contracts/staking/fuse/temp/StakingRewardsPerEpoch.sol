// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./StakingRewards.sol";

contract StakingRewardsPerEpoch is StakingRewards {


  struct StakeInfoPerEpoch {
    uint256 pendingStake;
    uint256 giveBackRatio;
    uint256 indexOfLastEpochStaked;
  }

  uint256 public lastCollectUBIInterestIndex;
  uint256 public totalPendingStakes;


  mapping (address => StakeInfoPerEpoch) public stakersInfoPerEpoch;

  constructor(
      address _rewardsToken,
      address _stakingToken
  ) StakingRewards(_rewardsToken, _stakingToken) {}

  function _stake(address _from, uint256 _amount) internal override {
    totalPendingStakes += _amount;
    stakersInfoPerEpoch[_from].pendingStake += _amount;
    stakingToken.safeTransferFrom(_from, address(this), _amount);
    emit PendingStaked(_from, _amount);
  }

  event PendingStaked(address indexed user, uint256 amount);
  event PendingWithdrawn(address indexed user, uint256 amount);

}
