// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingRewardsPerEpoch is ReentrancyGuard, Pausable {
	using SafeERC20 for IERC20;

	// the users info about stake
	struct StakerInfo {
		uint256 reward; // the reward amount which should be transfered to the user
		uint256 balance; // the amount of active stake of user
		uint256 pendingStake; // the amount of pending stake of user
		uint256 indexOfLastEpochStaked; // an index of the epoch from which the reward is calculated
	}

	// staker - an address of the staker, amount - an amount of staked tokens, epoch - an epoch when the stake was made
	event Staked(address indexed staker, uint256 amount, uint256 epoch);

	// staker - an address of the staker, amount - an amount of withdrawn tokens, epoch - an epoch when the withdraw was made
	event Withdrawn(address indexed staker, uint256 amount, uint256 epoch);

	// user - an address of the staker, reward - an amount of tokens that was rewarded to the staker, epoch - an epoch when the reward was made
	event RewardPaid(address indexed user, uint256 reward, uint256 epoch);

	// precision constant for math
	uint256 public constant PRECISION = 1e18;

	// the user info sheet
	mapping(address => StakerInfo) public stakersInfo;

	// the epoch counter
	uint256 public lastEpochIndex;

	// total supply of pending stakes
	uint256 public pendingStakes;

	// the amount of reward per token at a specific epoch
	uint256[] public rewardsPerTokenAt;

	// total supply of active stakes
	uint256 public totalSupply;

	modifier updateReward(address account) {
		_updateReward(account);
		_;
	}

	/**
	 * @dev A classic ERC20 method that allows staker balance querying.
	 * @param account A staker address
	 */
	function balanceOf(address account) external view returns (uint256) {
		return _balanceOf(account);
	}

	function _balanceOf(address account) internal view returns (uint256) {
		// The resulting balance of any user is the sum of an active earning balance
		// and pending waiting balance.
		return stakersInfo[account].balance + stakersInfo[account].pendingStake;
	}

	function _getRewardPerTokenPerUser(address _account)
		internal
		view
		returns (uint256)
	{
		// The userEpochIndex is used to calculate a reward per token per epoch
		// getting into account passed epochs.
		uint256 userEpochIndex = stakersInfo[_account].indexOfLastEpochStaked + 1;
		if (lastEpochIndex > userEpochIndex) {
			// Here we calculate the reward getting into account passed epochs.
			return rewardsPerTokenAt[lastEpochIndex] - rewardsPerTokenAt[userEpochIndex];
		} else {
			return 0;
		}
	}

	/**
	 * @dev The function allows anyone to calculate the exact amount of reward
	 * earned per epochs passed.
	 * @param account A staker address
	 */
	function earned(address account) public view returns (uint256) {
		return
			(stakersInfo[account].balance * _getRewardPerTokenPerUser(account))
				/ PRECISION
				+ stakersInfo[account].reward;
	}

	function _addPendingStakesToBalanceOnEpoch(address _account) internal {
		// If stakers balance wasn't updated when he staked and the staked
		// amount is greater than 0, then update active earning balance, nullify
		// pending one and update global sum of pending stakes.
		if (stakersInfo[_account].indexOfLastEpochStaked != lastEpochIndex
				&& stakersInfo[_account].pendingStake > 0) {
			stakersInfo[_account].balance += stakersInfo[_account].pendingStake;
      pendingStakes -= stakersInfo[_account].pendingStake;
			stakersInfo[_account].pendingStake = 0;
		}
	}

	// this function updates the reward for the specific user
	function _updateReward(address _account) internal virtual {
		_addPendingStakesToBalanceOnEpoch(_account);
		stakersInfo[_account].reward = earned(_account);
	}

	// This function adds the sum given in reward parameter to the distribution
	// queue.
	function _notifyRewardAmount(uint256 reward) internal {
		// update cumulative rewards
		rewardsPerTokenAt.push(
			rewardsPerTokenAt[rewardsPerTokenAt.length - 1]
				+ (reward * PRECISION) / totalSupply
		);
		// turn pending stakes to active stakes
		totalSupply += pendingStakes;
		pendingStakes = 0;

		// update epoch count
		lastEpochIndex++;
	}

	function _withdraw(address _from, uint256 _amount) internal virtual {
		// if there are any pending stake for _from
		if (stakersInfo[_from].pendingStake > 0) {
			// if pending stakes are higher or equal to requested withdrawal amount 
      // subtract whole amount, otherwise the pending stake there is
			uint256 pendingToReduce = stakersInfo[_from].pendingStake >= _amount
				? _amount
				: stakersInfo[_from].pendingStake;
			pendingStakes -= pendingToReduce;
			stakersInfo[_from].pendingStake -= pendingToReduce;
			stakersInfo[_from].balance -= _amount - pendingToReduce;
		} else {
			// elsewise just withdraw the active balance
			stakersInfo[_from].balance -= _amount;
		}
		emit Withdrawn(_from, _amount, lastEpochIndex);
	}

	function _stake(address _from, uint256 _amount)
  	internal
  	virtual
  {
		// the _from address could stake to the pending balance an above zero sum
		require(_amount > 0, "Cannot stake 0");
		pendingStakes += _amount;
		stakersInfo[_from].pendingStake += _amount;
		stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		emit Staked(_from, _amount, lastEpochIndex);
	}

	function _getReward(address _to) internal virtual returns(uint256 reward) {
		// return and reset the reward if there is any
		reward = stakersInfo[_to].reward;
		if (reward > 0) {
			stakersInfo[_to].reward = 0;
			emit RewardPaid(_to, reward, lastEpochIndex);
		}
	}
}