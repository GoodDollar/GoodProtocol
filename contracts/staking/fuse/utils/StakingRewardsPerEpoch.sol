// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

// import "@openzeppelin/contracts/security/Pausable.sol";
// import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
// import "@openzeppelin/contracts/access/AccessControl.sol";
// import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingRewardsPerEpoch 
// is AccessControl, ReentrancyGuard, Pausable 
{
	// using SafeERC20 for IERC20;

	struct StakerInfo {
		uint256 reward;
		uint256 balance;
		uint256 pendingStake;
		uint256 indexOfLastEpochStaked;
	}

	// event Staked(address indexed staker, uint256 amount);
	// event Withdrawn(address indexed staker, uint256 amount);
	// event RewardPaid(address indexed user, uint256 reward);
	// event Recovered(address token, uint256 amount);

	// bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
	// uint256 public constant PRECISION = 1e18;

	// IERC20 public rewardsToken;
	// IERC20 public stakingToken;

	mapping(address => StakerInfo) public stakersInfo;

	// uint256 public lastEpochIndex;
	uint256 public pendingStakes;
	// uint256[] public rewardsPerTokenAt;

	uint256 public totalSupply;

	function balanceOf(address account) external view returns (uint256) {
		return _balanceOf(account);
	}

	function _balanceOf(address account) internal view returns (uint256) {
		return stakersInfo[account].balance + stakersInfo[account].pendingStake;
	}

	function _addPendingStakesToBalanceOnTimeUpdate(address _account) internal {
    if (stakersInfo[_account].indexOfLastEpochStaked != lastEpochIndex) {
			stakersInfo[_account].balance += stakersInfo[_account].pendingStake;
			stakersInfo[_account].pendingStake = 0;
			pendingStakes -= stakersInfo[_account].pendingStake;
		}
	}

	function _updateReward(address _account) internal virtual {
		_addPendingStakesToBalanceOnTimeUpdate(_account);
		// stakersInfo[_account].reward = earned(_account);
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

		// stakingToken.safeTransfer(_from, _amount);
		// emit Withdrawn(_from, _amount);
	}

	function _stake(address _from, uint256 _amount) 
  internal 
  virtual 
  {
		require(_amount > 0, "Cannot stake 0");
		pendingStakes += _amount;
		stakersInfo[_from].pendingStake += _amount;
		// stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		// stakingToken.safeTransferFrom(_from, address(this), _amount);
		// emit Staked(_from, _amount);
	}
}
