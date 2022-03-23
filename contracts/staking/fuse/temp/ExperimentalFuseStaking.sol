// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "./StakingRewards.sol";

contract ExperimentalFuseStaking is StakingRewardsPerEpoch {

  uint256[] public collectUBIInterestCallTimes;

  function deposit

  function collectUBIInterest() external onlyRole(GUARDIAN_ROLE) {

  }
}
