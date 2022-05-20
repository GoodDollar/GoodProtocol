// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingRewardsFixedAPY {
	using SafeERC20 for IERC20;

	// the users stake information
	struct StakerInfo {
		uint256 reward; // the reward amount which should be transfered to the user
		uint256 balance; // the amount of user active stake
		uint256 rewardPerTokenPaid; // rewards that accounted already so should be substracted
		// while calculating rewards of staker
	}

	// precision constant for math
	uint256 public constant PRECISION = 1e18;

	// the user info sheet
	mapping(address => StakerInfo) public stakersInfo;

	// last timestamp this staking contract was updated and rewards were calculated
	uint256 public lastUpdateTime;

	// the amount of reward per token
	uint256 public rewardPerTokenStored;

	// total supply of active stakes
	uint256 public totalSupply;

	// annual percentage yield - rate of return on stake over one year
	// in BPS format. e.g. apy = 500 means 5% (500/10000)
	uint256 internal _apy;

	// interest rate per one block. Equal to _apy * 1e14 / numberOfBlocksPerYear
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
	 * earned.
	 * @param account A staker address
	 */
	function earned(address account) public returns (uint256) {
		return
			(stakersInfo[account].balance *
      (_rewardPerToken() - stakersInfo[account].rewardPerTokenPaid)) /
			PRECISION;
	}

	// this function updates the reward for the specific user
	function _updateReward(address _account) internal virtual {
		rewardPerTokenStored = _rewardPerToken();
		lastUpdateTime = block.timestamp;
		if (_account != address(0)) {
			stakersInfo[_account].reward += earned(_account);
			stakersInfo[_account].rewardPerTokenPaid = rewardPerTokenStored;
		}
	}

	function _withdraw(address _from, uint256 _amount) internal virtual {
		require(_amount > 0, "Cannot withdraw 0");
		totalSupply -= _amount;
		stakersInfo[_from].balance -= _amount;
	}

	function _stake(address _from, uint256 _amount) internal virtual {
		require(_amount > 0, "Cannot stake 0");
		totalSupply += _amount;
		stakersInfo[_from].balance += _amount;
	}

	function _getReward(address _to) internal virtual returns (uint256 reward) {
		// return and reset the reward if there is any
		reward = stakersInfo[_to].reward;
		if (reward > 0) {
			stakersInfo[_to].reward = 0;
		}
	}

	// function lastTimeRewardApplicable() public view returns (uint256) {
	//   return block.timestamp < periodFinish ? block.timestamp : periodFinish;
	// }
}
