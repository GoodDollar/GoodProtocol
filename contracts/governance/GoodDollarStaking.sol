// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../DAOStackInterfaces.sol";
import "./MultiBaseGovernanceShareField.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "../staking/utils/StakingRewardsFixedAPY.sol";

interface RewardsMinter {
	function sendOrMint(address to, uint256 amount) external returns (uint256);
}

/**
 * @title Staking contract that allows citizens to stake G$ to get GOOD + G$ rewards
 * it implements
 */
contract GoodDollarStaking is
	ERC20Upgradeable,
	MultiBaseGovernanceShareField,
	DAOUpgradeableContract,
	ReentrancyGuardUpgradeable,
	StakingRewardsFixedAPY
{
	// Token address
	ERC20 token;

	uint128 public numberOfBlocksPerYear;

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
	constructor(
		INameService _ns,
		uint128 _interestRatePerBlock,
		uint128 _numberOfBlocksPerYear
	) StakingRewardsFixedAPY(_interestRatePerBlock) {
		setDAO(_ns);
		require(
			nameService.getAddress("MintBurnWrapper") != address(0),
			"rewards minter not set"
		);
		numberOfBlocksPerYear = _numberOfBlocksPerYear;
		token = ERC20(nameService.getAddress("GOODDOLLAR"));
		__ERC20_init("G$ Savings", "svG$");
		rewardsPerBlock[address(this)] = (2 ether * 1e6) / getChainBlocksPerMonth(); // (2M monthly GDAO as specified in specs, divided by blocks in month )
	}

	function getChainBlocksPerMonth() public view override returns (uint256) {
		return numberOfBlocksPerYear / 12;
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
		/* GOOD rewards Updates */
		_increaseProductivity(
			address(this),
			_msgSender(),
			_amount,
			0,
			block.number
		);
		_mint(_msgSender(), _amount); // mint Staking token for staker
		_mintRewards(_msgSender());
		/* end GOOD rewards Updates */

		/* G$ rewards updates */
		_stake(_msgSender(), _amount);

		emit Staked(_msgSender(), _amount);
	}

	/**
	 * @dev Withdraws _amount from the staker principle
	 * we use getPrinciple and not getProductivity because the user can have more G$ to withdraw than he staked
	 */
	function withdrawStake(uint256 _amount)
		public
		nonReentrant
		returns (uint256 goodRewards, uint256 gdRewards)
	{
		uint256 accountBalance = getPrinciple(_msgSender());
		if (_amount == 0) _amount = accountBalance;
		require(_amount > 0, "Should withdraw positive amount");
		require(accountBalance >= _amount, "Not enough token staked");

		uint256 depositComponent;
		/* G$ rewards update */
		//we get the relative part user is withdrawing from his original deposit, his principle is composed of deposit+earned interest
		(depositComponent, gdRewards) = _withdraw(_msgSender(), _amount);

		_burn(_msgSender(), depositComponent); // burn their staking tokens

		/* Good rewards update */
		if (depositComponent > 0) {
			_decreaseProductivity(
				address(this),
				_msgSender(),
				depositComponent,
				0,
				block.number
			);
		}
		goodRewards = _mintRewards(_msgSender());
		/* end Good rewards update */

		//rewards are paid via the rewards distribution contract
		if (gdRewards > 0) {
			_mintGDRewards(_msgSender(), gdRewards);
		}

		//stake is withdrawn from original deposit sent to this contract
		if (depositComponent > 0) {
			require(
				token.transfer(_msgSender(), depositComponent),
				"withdraw transfer failed"
			);
		}
		emit StakeWithdraw(_msgSender(), _amount, goodRewards, gdRewards);
	}

	function _mintGDRewards(address _to, uint256 _amount)
		internal
		returns (uint256 actualSent)
	{
		//make sure RewardsMinter failure doesnt prevent withdrawl of stake
		try
			RewardsMinter(nameService.getAddress("MintBurnWrapper")).sendOrMint(
				_to,
				_amount
			)
		returns (uint256 _res) {
			actualSent = _res;
		} catch {
			actualSent = 0;
		}
		//it could be that rewards minter doesnt have enough or passed cap
		//so we keep track of debt to user
		if (actualSent < _amount) {
			_undoReward(_to, _amount - actualSent);
		}
	}

	/**
	 * @dev Staker can withdraw their rewards without withdraw their stake
	 */
	function withdrawRewards()
		public
		nonReentrant
		returns (uint256 goodRewards, uint256 gdRewards)
	{
		gdRewards = earned(_msgSender());

		//this will trigger a withdraw only of rewards part
		return withdrawStake(gdRewards);
	}

	/**
	 * @dev Mint GOOD rewards of the staker
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
		(uint256 depositComponent, ) = _withdraw(from, value); //update G$ rewards

		//we only update GOOD staking amount if user is transfering G$s from his original stake and not just from the principle rewards
		if (depositComponent > 0)
			_decreaseProductivity(
				address(this),
				from,
				depositComponent,
				0,
				block.number
			);

		//the recipient sent G$ are considered like he is staking them, so they will also earn GOOD rewards
		//even if sender transfered G$s from his rewardsComponent which doesnt earn GOOD rewards
		_increaseProductivity(address(this), to, value, 0, block.number);
		_stake(to, value); //update G$ rewards

		//mint GOOD rewards
		_mintRewards(from);
		_mintRewards(to);

		super._transfer(from, to, value);
	}

	/**
	 * @dev Calculate rewards per block from monthly amount of rewards and set it
	 * @param _monthlyAmount total rewards which will distribute monthly
	 */
	function setMonthlyGOODRewards(uint256 _monthlyAmount) public {
		_onlyAvatar();
		_setMonthlyRewards(address(this), _monthlyAmount);
	}

	/**
	 * @dev Calculate rewards per block from monthly amount of rewards and set it
	 * @param _interestRatePerBlock bps yearly apy
	 */
	function setGdApy(uint128 _interestRatePerBlock) public {
		_onlyAvatar();
		_setAPY(_interestRatePerBlock);
	}

	/// @dev helper function for multibase and FixedAPYRewards
	function getRewardsPerBlock()
		public
		view
		returns (uint256 _goodRewardPerBlock, int128 _gdRewardPerBlockX64)
	{
		_goodRewardPerBlock = rewardsPerBlock[address(this)];
		_gdRewardPerBlockX64 = interestRatePerBlockX64;
	}

	/// @dev helper function for multibase and FixedAPYRewards - same stake amount for both
	function getStaked(address _user)
		public
		view
		returns (uint256 userStake, uint256 totalStaked)
	{
		return getProductivity(address(this), _user);
	}

	/// @dev helper function for multibase and FixedAPYRewards
	function getUserPendingReward(address _user)
		public
		view
		returns (uint256 _goodReward, uint256 _gdReward)
	{
		// GOOD rewards
		_goodReward = getUserPendingReward(address(this), 0, block.number, _user);

		_gdReward = earned(_user);
	}

	/// @dev helper function for multibase and FixedAPYRewards
	function totalRewardsPerShare()
		public
		view
		returns (uint256 _goodRewardPerShare, uint128 _gdRewardPerShare)
	{
		_goodRewardPerShare = super.totalRewardsPerShare(address(this));
		_gdRewardPerShare = sharePrice();
	}

	/// @dev helper function for multibase
	function goodStakerInfo(address _user) public view returns (UserInfo memory) {
		return contractToUsers[address(this)][_user];
	}

	/// @dev helper function for FixedAPYRewards
	function gdStakerInfo(address _user) public view returns (StakerInfo memory) {
		return stakersInfo[_user];
	}
}
