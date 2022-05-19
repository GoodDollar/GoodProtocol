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
		uint256 rewardPerTokenPaid; // the amount of pending stake of user
	}

	// staker - an address of the staker, amount - an amount of staked tokens
	event Staked(address indexed staker, uint256 amount);

	// staker - an address of the staker, amount - an amount of withdrawn tokens
	event Withdrawn(address indexed staker, uint256 amount);

	// user - an address of the staker, reward - an amount of tokens that was rewarded to the staker
	event RewardPaid(address indexed user, uint256 reward);

	// precision constant for math
	uint256 public constant PRECISION = 1e18;

	// the user info sheet
	mapping(address => StakerInfo) public stakersInfo;

	uint256 public lastUpdateTime;

	// the amount of reward per token at a specific epoch
	uint256 public rewardPerTokenStored;

	// total supply of active stakes
	uint256 public totalSupply;

	uint256 public interestRatePerBlock;

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
		return stakersInfo[account].balance;
	}

	function _rewardPerToken() internal returns (uint256) {
		if (totalSupply == 0) {
			return rewardPerTokenStored;
		}

		return
			rewardPerTokenStored +=
				(block.timestamp - lastUpdateTime) *
				interestRatePerBlock;
	}

	/**
	 * @dev The function allows anyone to calculate the exact amount of reward
	 * earned per epochs passed.
	 * @param account A staker address
	 */
	function earned(address account) public returns (uint256) {
		return
			(stakersInfo[account].balance *
				(_rewardPerToken() - stakersInfo[account].rewardPerTokenPaid)) /
			PRECISION +
			stakersInfo[account].reward;
	}

	// this function updates the reward for the specific user
	function _updateReward(address _account) internal virtual {
		rewardPerTokenStored = _rewardPerToken();
		lastUpdateTime = block.timestamp;
		if (_account != address(0)) {
			stakersInfo[_account].reward = earned(_account);
			stakersInfo[_account].rewardPerTokenPaid = rewardPerTokenStored;
		}
	}

	// This function adds the sum given in reward parameter to the distribution
	// queue.
	// function _notifyRewardAmount(uint256 reward) internal {
	// 	// update cumulative rewards
	// 	rewardsPerTokenAt.push(
	// 		rewardsPerTokenAt[rewardsPerTokenAt.length - 1]
	// 			+ (reward * PRECISION) / totalSupply
	// 	);

	// 	// update epoch count
	// 	lastEpochIndex++;
	// }

	function _withdraw(address _from, uint256 _amount) internal virtual {
		require(_amount > 0, "Cannot withdraw 0");
		totalSupply -= _amount;
		stakersInfo[_from].balance -= _amount;
		emit Withdrawn(_from, _amount);
	}

	function _stake(address _from, uint256 _amount) internal virtual {
		require(_amount > 0, "Cannot stake 0");
		totalSupply += _amount;
		stakersInfo[_from].balance += _amount;
		emit Staked(_from, _amount);
	}

	function _getReward(address _to) internal virtual returns (uint256 reward) {
		// return and reset the reward if there is any
		reward = stakersInfo[_to].reward;
		if (reward > 0) {
			stakersInfo[_to].reward = 0;
			emit RewardPaid(_to, reward);
		}
	}

	// function lastTimeRewardApplicable() public view returns (uint256) {
	//   return block.timestamp < periodFinish ? block.timestamp : periodFinish;
	// }
}
