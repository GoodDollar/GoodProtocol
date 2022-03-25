// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingRewardsPerEpoch is AccessControl, ReentrancyGuard, Pausable {
	using SafeERC20 for IERC20;

	struct StakeInfo {
		uint256 rewardPerTokenPaid;
		uint256 reward;
		uint256 balance;
		uint256 pendingStake;
		uint256 indexOfLastEpochStaked;
	}

	event Staked(address indexed staker, uint256 amount);
	event Withdrawn(address indexed staker, uint256 amount);
	event RewardAdded(uint256 reward);
	event RewardPaid(address indexed user, uint256 reward);
	event RewardsDurationUpdated(uint256 newDuration);
	event Recovered(address token, uint256 amount);

	bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
	uint256 public constant PRECISION = 1e18;

	IERC20 public rewardsToken;
	IERC20 public stakingToken;

	mapping(address => StakeInfo) public stakersInfo;

	uint256 public lastEpochIndex;
	uint256 public pendingStakes;
	uint256[] public rewardsPerTokenAt;

	uint256 internal _totalSupply;

	modifier updateReward(address account) {
		_updateReward(account);
		_;
	}

	constructor(address _rewardsToken, address _stakingToken) {
		_setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
		_setupRole(GUARDIAN_ROLE, msg.sender);
		rewardsToken = IERC20(_rewardsToken);
		stakingToken = IERC20(_stakingToken);
	}

	function totalSupply() external view returns (uint256) {
		return _totalSupply;
	}

	function balanceOf(address account) external view returns (uint256) {
		return stakersInfo[account].balance;
	}

	function stake(uint256 amount)
		external
		payable
		nonReentrant
		whenNotPaused
		updateReward(msg.sender)
	{
		require(amount > 0, "Cannot stake 0");
		_stake(msg.sender, amount);
	}

	function withdraw(uint256 _amount)
		public
		nonReentrant
		updateReward(msg.sender)
	{
		require(_amount > 0, "Cannot withdraw 0");
		_withdraw(msg.sender, _amount);
	}

	function getReward() public nonReentrant updateReward(msg.sender) {
		_getReward(msg.sender);
	}

	function exit() external {
		withdraw(stakersInfo[msg.sender].balance);
		getReward();
	}

	function rewardPerToken() public view returns (uint256) {
		if (_totalSupply == 0) {
			return rewardPerTokenAt[0];
		}
		return
			rewardPerTokenStored +
			((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * PRECISION) /
			_totalSupply;
	}

	function _getRewardPerTokenPerUser(address _account)
		internal
		view
		returns (uint256)
	{
		return
			rewardsPerTokenAt[lastEpochIndex] -
			rewardsPerTokenAt[stakersInfo[_account].indexOfLastEpochStaked + 1];
	}

	function earned(address account) public view  returns (uint256) {
		return
			(stakersInfo[account].balance *
				(rewardPerToken() -
					stakersInfo[account].rewardPerTokenPaid)) /
			PRECISION +
			stakersInfo[account].reward;
	}

	function _updateReward(address _account) internal virtual {
		lastUpdateTime = lastTimeRewardApplicable();
		if (_account != address(0)) {
			_addPendingStakesToBalanceOnTimeUpdate(_account);
			stakersInfo[_account].reward = earned(_account);
			stakersInfo[_account]
					.rewardPerTokenPaid = _getRewardPerTokenPerUser(_account);
		}
	}

	function _addPendingStakesToBalanceOnTimeUpdate(address _account) internal {
		if (
					stakersInfo[_account].indexOfLastEpochStaked !=
					lastEpochIndex
		) {
				stakersInfo[_account].balance += stakersInfo[_account]
						.pendingStake;
				stakersInfo[_account].pendingStake = 0;
		}
	}

	function _updatePeriodAndRate(uint256 reward) internal virtual {
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
		require(
			rewardRate <= rewardsToken.balanceOf(address(this)) / rewardsDuration,
			"Provided reward too high"
		);

		lastUpdateTime = block.timestamp;
		periodFinish = block.timestamp + rewardsDuration;
		emit RewardAdded(reward);
	}

	function _notifyRewardAmount(uint256 reward)
		internal
		updateReward(address(0))
	{
		_totalSupply += pendingStakes;
		rewardsPerTokenAt.push(rewardPerToken());
		lastEpochIndex++;
		_updatePeriodAndRate(reward);
	}

	function _withdraw(address _from, uint256 _amount) internal virtual {
		if (stakersInfo[_from].pendingStake >= _amount) {
			pendingStakes -= _amount;
			stakersInfo[_from].pendingStake -= _amount;
		}
		stakingToken.safeTransfer(_from, _amount);
		emit Withdrawn(_from, _amount);
	}

	function _stake(address _from, uint256 _amount) internal virtual {
		pendingStakes += _amount;
		stakersInfo[_from].pendingStake += _amount;
		stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		stakingToken.safeTransferFrom(_from, address(this), _amount);
		emit Staked(_from, _amount);
	}

	function _getReward(address _to) internal virtual {
		uint256 reward = stakersInfo[_to].reward;
		if (reward > 0) {
			stakersInfo[_to].reward = 0;
			rewardsToken.safeTransfer(_to, reward);
			emit RewardPaid(_to, reward);
		}
	}

	receive() external payable {}
}
