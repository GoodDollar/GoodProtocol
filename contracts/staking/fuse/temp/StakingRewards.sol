// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingRewards is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    IERC20 public rewardsToken;
    IERC20 public stakingToken;
    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public rewardsDuration = 7 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    struct StakeInfo {
      uint256 rewardPerTokenPaid;
      uint256 reward;
      uint256 balance;
    }

    mapping(address => StakeInfo) internal stakeInfos;

    uint256 private _totalSupply;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    uint256 public constant PRECISION = 1e18;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address _rewardsToken,
        address _stakingToken
    ) public {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(GUARDIAN_ROLE, msg.sender);
        rewardsToken = IERC20(_rewardsToken);
        stakingToken = IERC20(_stakingToken);
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return stakeInfos[account].balance;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored + (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * PRECISION / _totalSupply;
    }

    function earned(address account) public view returns (uint256) {
        return stakeInfos[account].balance * (rewardPerToken() - stakeInfos[account].rewardPerTokenPaid) / PRECISION + stakeInfos[account].reward;
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function _stake(address _from, uint256 _amount) internal {
        _totalSupply += amount;
        stakeInfos[_from].balance += amount;
        stakingToken.safeTransferFrom(_from, address(this), amount);
        emit Staked(_from, amount);
    }

    function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        _stake(msg.sender, amount);
    }

    function _withdraw(address _from, uint256 _amount) internal {
        _totalSupply -= amount;
        stakeInfos[_from].balance -= amount;
        stakingToken.safeTransfer(_from, amount);
        emit Withdrawn(_from, amount);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _withdraw(msg.sender, amount);
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = stakeInfos[msg.sender].reward;
        if (reward > 0) {
            stakeInfos[msg.sender].reward = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        withdraw(stakeInfos[msg.sender].balance);
        getReward();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

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

    // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyRole(GUARDIAN_ROLE) {
        require(tokenAddress != address(stakingToken), "Cannot withdraw the staking token");
        IERC20(tokenAddress).safeTransfer(msg.sender, tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    function setRewardsDuration(uint256 _rewardsDuration) external onlyRole(GUARDIAN_ROLE) {
        require(
            block.timestamp > periodFinish,
            "Previous rewards period must be complete before changing the duration for the new period"
        );
        rewardsDuration = _rewardsDuration;
        emit RewardsDurationUpdated(rewardsDuration);
    }

    /* ========== MODIFIERS ========== */

    function _updateReward(address _account) internal virtual {
      rewardPerTokenStored = rewardPerToken();
      lastUpdateTime = lastTimeRewardApplicable();
      if (account != address(0)) {
          stakeInfos[account].reward = earned(account);
          stakeInfos[account].rewardPerTokenPaid = rewardPerTokenStored;
      }
    }

    modifier updateReward(address account) {
        _updateReward(account);
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);
}
