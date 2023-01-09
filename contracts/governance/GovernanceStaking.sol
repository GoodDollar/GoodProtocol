// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../DAOStackInterfaces.sol";
import "./MultiBaseGovernanceShareField.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/**
 * @title Staking contract that allows citizens to stake G$ to get GDAO rewards
 */
contract GovernanceStaking is
	ERC20Upgradeable,
	MultiBaseGovernanceShareField,
	DAOUpgradeableContract,
	ReentrancyGuardUpgradeable
{
	uint256 public constant FUSE_MONTHLY_BLOCKS = 12 * 60 * 24 * 30;

	// Token address
	ERC20 token;

	/**
	 * @dev Emitted when `staker` earns an `amount` of GOOD tokens
	 */
	event ReputationEarned(address indexed staker, uint256 amount);

	/**
	 * @dev Emitted when `staker` stakes an `amount` of GoodDollars
	 */
	event Staked(address indexed staker, uint256 amount);

	/**
	 * @dev Emitted when `staker` withdraws an `amount` of staked GoodDollars
	 */
	event StakeWithdraw(address indexed staker, uint256 amount);

	/**
	 * @dev Constructor
	 * @param _ns The address of the INameService contract
	 */
	constructor(INameService _ns) initializer {
		setDAO(_ns);
		token = ERC20(nameService.getAddress("GOODDOLLAR"));
		__ERC20_init("G$ Staking For GOOD", "sG$");
		rewardsPerBlock[address(this)] = (2 ether * 1e6) / FUSE_MONTHLY_BLOCKS; // (2M monthly GDAO as specified in specs, divided by blocks in month )
	}

	/**
	 * @dev this contract runs on fuse
	 */
	function getChainBlocksPerMonth() public pure override returns (uint256) {
		return 518400; //12 * 60 * 24 * 30
	}

	/**
	 * @dev Allows a staker to deposit Tokens. Notice that `approve` is
	 * needed to be executed before the execution of this method.
	 * Can be executed only when the contract is not paused.
	 * @param _amount The amount of GD to stake
	 */
	function stake(uint256 _amount) external {
		require(_amount > 0, "You need to stake a positive token amount");
		require(
			token.transferFrom(_msgSender(), address(this), _amount),
			"transferFrom failed, make sure you approved token transfer"
		);
		_increaseProductivity(
			address(this),
			_msgSender(),
			_amount,
			0,
			block.number
		);
		_mint(_msgSender(), _amount); // mint Staking token for staker
		_mintRewards(_msgSender());
		emit Staked(_msgSender(), _amount);
	}

	/**
	 * @dev Withdraws the sender staked Token.
	 */
	function withdrawStake(uint256 _amount) external nonReentrant {
		(uint256 userProductivity, ) = getProductivity(address(this), _msgSender());
		if (_amount == 0) _amount = userProductivity;
		require(_amount > 0, "Should withdraw positive amount");
		require(userProductivity >= _amount, "Not enough token staked");
		uint256 tokenWithdraw = _amount;

		_burn(_msgSender(), _amount); // burn their staking tokens
		_decreaseProductivity(
			address(this),
			_msgSender(),
			_amount,
			0,
			block.number
		);
		_mintRewards(_msgSender());

		require(
			token.transfer(_msgSender(), tokenWithdraw),
			"withdraw transfer failed"
		);
		emit StakeWithdraw(_msgSender(), _amount);
	}

	/**
	 * @dev Staker can withdraw their rewards without withdraw their stake
	 */
	function withdrawRewards() public nonReentrant returns (uint256) {
		return _mintRewards(_msgSender());
	}

	/**
	 * @dev Mint rewards of the staker
	 * @param user Receipent address of the rewards
	 * @return Returns amount of the minted rewards
	 * emits 'ReputationEarned' event for staker earned GOOD amount
	 */
	function _mintRewards(address user) internal returns (uint256) {
		uint256 amount = _issueEarnedRewards(address(this), user, 0, block.number);
		if (amount > 0) {
			ERC20(nameService.getAddress("REPUTATION")).mint(user, amount);
			emit ReputationEarned(_msgSender(), amount);
		}
		return amount;
	}

	/**
	 * @dev Returns the number of decimals used to get its user representation.
	 */
	function decimals() public view virtual override returns (uint8) {
		return 2;
	}

	/**
	 * @dev override _transfer to handle rewards calculations when transfer the stake
	 */
	function _transfer(
		address from,
		address to,
		uint256 value
	) internal override {
		_decreaseProductivity(address(this), from, value, 0, block.number);
		_increaseProductivity(address(this), to, value, 0, block.number);
		_mintRewards(from);
		_mintRewards(to);
		super._transfer(from, to, value);
	}

	/**
	 * @dev Calculate rewards per block from monthly amount of rewards and set it
	 * @param _monthlyAmount total rewards which will distribute monthly
	 */
	function setMonthlyRewards(uint256 _monthlyAmount) public {
		_onlyAvatar();
		_setMonthlyRewards(address(this), _monthlyAmount);
	}

	/// @dev helper function for multibase
	function getRewardsPerBlock() public view returns (uint256) {
		return rewardsPerBlock[address(this)];
	}

	/// @dev helper function for multibase
	function getProductivity(address _user)
		public
		view
		returns (uint256, uint256)
	{
		return getProductivity(address(this), _user);
	}

	/// @dev helper function for multibase
	function getUserPendingReward(address _user) public view returns (uint256) {
		return getUserPendingReward(address(this), 0, block.number, _user);
	}

	/// @dev helper function for multibase
	function users(address _user) public view returns (UserInfo memory) {
		return contractToUsers[address(this)][_user];
	}

	function totalRewardsPerShare() public view returns (uint256) {
		return totalRewardsPerShare(address(this));
	}
}
