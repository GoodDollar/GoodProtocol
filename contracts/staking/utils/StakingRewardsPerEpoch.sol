// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingRewardsPerEpoch is ReentrancyGuard, Pausable {
	using SafeERC20 for IERC20;

	struct StakerInfo {
		uint256 reward;
		uint256 balance;
		uint256 pendingStake;
		uint256 indexOfLastEpochStaked;
	}

	event Staked(address indexed staker, uint256 amount, uint256 epoch);
	event Withdrawn(address indexed staker, uint256 amount, uint256 epoch);
	event RewardPaid(address indexed user, uint256 reward, uint256 epoch);

	uint256 public constant PRECISION = 1e18;

	mapping(address => StakerInfo) public stakersInfo;

	uint256 public lastEpochIndex;
	uint256 public pendingStakes;
	uint256[] public rewardsPerTokenAt;

	uint256 public totalSupply;

	modifier updateReward(address account) {
		_updateReward(account);
		_;
	}

	function balanceOf(address account) external view returns (uint256) {
		return _balanceOf(account);
	}

	function _balanceOf(address account) internal view returns (uint256) {
		return stakersInfo[account].balance + stakersInfo[account].pendingStake;
	}

	function _getRewardPerTokenPerUser(address _account)
		internal
		view
		returns (uint256)
	{
		uint256 userIndex = stakersInfo[_account].indexOfLastEpochStaked + 1;
		if (lastEpochIndex > userIndex) {
			return rewardsPerTokenAt[lastEpochIndex] - rewardsPerTokenAt[userIndex];
		} else {
			return 0;
		}
	}

	function earned(address account) public view returns (uint256) {
		return
			(stakersInfo[account].balance * _getRewardPerTokenPerUser(account)) /
			PRECISION +
			stakersInfo[account].reward;
	}

	function _addPendingStakesToBalanceOnEpoch(address _account) internal {
		if (stakersInfo[_account].indexOfLastEpochStaked != lastEpochIndex
				&& stakersInfo[_account].pendingStake > 0) {
			stakersInfo[_account].balance += stakersInfo[_account].pendingStake;
			stakersInfo[_account].pendingStake = 0;
			pendingStakes -= stakersInfo[_account].pendingStake;
		}
	}

	function _updateReward(address _account) internal virtual {
		_addPendingStakesToBalanceOnTimeUpdate(_account);
		stakersInfo[_account].reward = earned(_account);
	}

	function _notifyRewardAmount(uint256 reward) internal {
		rewardsPerTokenAt.push((reward * PRECISION) / totalSupply);
		totalSupply += pendingStakes;
		lastEpochIndex++;
	}

	function _withdraw(address _from, uint256 _amount) internal virtual {
		if (stakersInfo[_from].pendingStake > 0) {
			uint256 pendingToReduce = stakersInfo[_from].pendingStake >= _amount
				? _amount
				: stakersInfo[_from].pendingStake;
			pendingStakes -= pendingToReduce;
			stakersInfo[_from].pendingStake -= pendingToReduce;
			stakersInfo[_from].balance -= _amount - pendingToReduce;
		} else {
			stakersInfo[_from].balance -= _amount;
		}
		emit Withdrawn(_from, _amount, lastEpochIndex);
	}

	function _stake(address _from, uint256 _amount)
  	internal
  	virtual
  {
		require(_amount > 0, "Cannot stake 0");
		pendingStakes += _amount;
		stakersInfo[_from].pendingStake += _amount;
		stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		emit Staked(_from, _amount, lastEpochIndex);
	}

	function _getReward(address _to) internal virtual returns(uint256 reward) {
		reward = stakersInfo[_to].reward;
		if (reward > 0) {
			stakersInfo[_to].reward = 0;
			emit RewardPaid(_to, reward, lastEpochIndex);
		}
	}
}
