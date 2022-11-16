// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import { ERC20 as ERC20_OZ } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../utils/DAOContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../DAOStackInterfaces.sol";
import "./MultiBaseGovernanceShareField.sol";
import "../staking/utils/StakingRewardsFixedAPY.sol";

// import "hardhat/console.sol";

interface RewardsMinter {
	function sendOrMint(address to, uint256 amount) external returns (uint256);
}

interface IGovernanceStaking {
	function withdrawRewards() external returns (uint256);
}

interface IStakingUpgrade {
	function upgradeFrom(address staker, uint256 amount)
		external
		returns (uint256 newShares);
}

/**
 * @title Staking contract that allows citizens to stake G$ to get GOOD + G$ rewards
 * it implements
 */
contract GoodDollarStaking is
	ERC20_OZ,
	MultiBaseGovernanceShareField,
	DAOContract,
	ReentrancyGuard,
	Pausable,
	StakingRewardsFixedAPY
{
	// Token address
	ERC20 public token;

	uint128 public numberOfBlocksPerYear; //required for getChainBlocksPerMonth for GOOD rewards calculations

	uint128 public createdAt; //required for upgrade process
	uint32 public daysUntilUpgrade; //required for upgrade process

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
	event StakeWithdraw(
		address indexed staker,
		uint256 actualSharesRedeemed, //shares withdrawn , if not all rewards minted then this can be lower than sharesRequested
		uint256 amount, //amount withdrawn including actualRewardsSent
		uint256 sharesRequested, //shares requested to redeem
		uint256 goodRewards,
		uint256 gdRewards,
		uint256 actualRewardsSent //maybe rewards could not be minted
	);

	event StakeUpgraded(
		address indexed staker,
		uint256 amount, //amount withdrawn including actualRewardsSent
		uint256 sharesRedeemed, //shares requested to redeem
		uint256 goodRewards,
		uint256 gdRewards,
		uint256 newShares
	);

	/**
	 * @dev Emitted when `staker` withdraws but MintBurnWrapper could not allocate/mint the rewards
	 */
	event RewardsNotSent(
		address indexed staker,
		uint256 gdRewards,
		uint256 actualRewardsSent //rewards not minted
	);

	event APYSet(uint128 newAPY);

	event GOODRewardsSet(uint256 newMonthlyRewards);

	/**
	 * @dev Constructor
	 * @param _ns The address of the INameService contract
	 * @param _interestRatePerBlock G$ rewards fixed APY in 1e18 precision
	 * @param _numberOfBlocksPerYear blockchain approx blocks per year for GOOD rewards
	 * @param _daysUntilUpgrade when it is allowed to upgrade from older GovernanceStaking
	 */
	constructor(
		INameService _ns,
		uint128 _interestRatePerBlock,
		uint128 _numberOfBlocksPerYear,
		uint32 _daysUntilUpgrade
	) ERC20_OZ("G$ Savings", "svG$") {
		require(_daysUntilUpgrade <= 60, "max two months until upgrade");
		_setAPY(_interestRatePerBlock);
		setDAO(_ns);
		numberOfBlocksPerYear = _numberOfBlocksPerYear;
		token = ERC20(nameService.getAddress("GOODDOLLAR"));
		rewardsPerBlock[address(this)] = 0;
		createdAt = uint128(block.timestamp);
		daysUntilUpgrade = _daysUntilUpgrade;
	}

	/**
	 * @notice return approx chain blocks per month
	 * @return blocksPerMonth approx blocks per month
	 */
	function getChainBlocksPerMonth()
		public
		view
		override
		returns (uint256 blocksPerMonth)
	{
		return numberOfBlocksPerYear / 12;
	}

	/**
	 * @dev Allows a staker to deposit Tokens. Notice that `approve` is
	 * needed to be executed before the execution of this method.
	 * Can be executed only when the contract is not paused.
	 * @param _amount The amount of GD to stake
	 */
	function stake(uint256 _amount) external {
		require(
			token.transferFrom(msg.sender, address(this), _amount),
			"transferFrom failed, make sure you approved token transfer"
		);
		_stakeFrom(msg.sender, _amount);
	}

	/**
	 * @dev helper for staking
	 * @param _from address of staker
	 * @param _amount The amount of GD to stake
	 */
	function _stakeFrom(address _from, uint256 _amount) internal whenNotPaused {
		/* G$ rewards updates */
		uint256 shares = _stake(_from, _amount); //this will validate _amount
		_mint(_from, shares); // mint Staking token for staker

		/* GOOD rewards Updates */
		_increaseProductivity(address(this), _from, shares, 0, block.number);
		_mintGOODRewards(_from);
		/* end GOOD rewards Updates */

		emit Staked(_from, _amount);
	}

	/**
	 * @notice helper for staking through G$ transferAndCall without approve
	 * @param _from address of sender
	 * @param _amount The amount of GD to stake
	 */
	function onTokenTransfer(
		address _from,
		uint256 _amount,
		bytes calldata
	) external returns (bool success) {
		require(msg.sender == address(token), "unsupported token");

		_stakeFrom(_from, _amount);
		return true;
	}

	function _withdrawStake(
		address from,
		address to,
		uint256 _shares
	)
		internal
		returns (
			uint256 goodRewards,
			uint256 gdRewards,
			uint256 actualRewardsSent,
			uint256 depositComponent
		)
	{
		if (_shares > 0) {
			/* G$ rewards update */
			//we get the relative part user is withdrawing from his original deposit, his principle is composed of deposit+earned interest
			(depositComponent, gdRewards) = _withdraw(from, _shares);
			/* Good rewards update */
			_decreaseProductivity(address(this), from, _shares, 0, block.number);
			_burn(from, _shares); // burn their staking tokens
		}

		// console.log(
		// 	"withdraStake: fromDeposit: %s, fromRewards: %s",
		// 	depositComponent,
		// 	gdRewards
		// );

		goodRewards = _mintGOODRewards(from);

		//rewards are paid via the rewards distribution contract
		if (gdRewards > 0) {
			actualRewardsSent = _mintGDRewards(from, to, gdRewards);
		}

		//stake is withdrawn from original deposit sent to this contract
		if (depositComponent > 0) {
			require(token.transfer(to, depositComponent), "withdraw transfer failed");
		}
	}

	/**
	 * @notice Withdraws _amount from the staker principle
	 * in _withdraw we use getPrinciple and not getProductivity because the user can have more G$ to withdraw than he staked
	 * @param _shares amount to withdraw
	 * @return goodRewards how much GOOD rewards were transfered to staker
	 * @return gdRewards out of withdrawn amount how much was taken from earned interest (amount-gdRewards = taken from deposit)
	 */
	function withdrawStake(uint256 _shares)
		public
		nonReentrant
		returns (uint256 goodRewards, uint256 gdRewards)
	{
		//in case amount is 0 this will just withdraw the GOOD rewards, this is required for withdrawRewards
		uint256 originalBalance = sharesOf(msg.sender);
		uint256 depositComponent;
		uint256 actualRewardsSent;

		(
			goodRewards,
			gdRewards,
			actualRewardsSent,
			depositComponent
		) = _withdrawStake(msg.sender, msg.sender, _shares);

		uint256 actualSharesRedeemed = originalBalance - sharesOf(msg.sender);

		emit StakeWithdraw(
			msg.sender,
			actualSharesRedeemed,
			depositComponent + actualRewardsSent,
			_shares,
			goodRewards,
			gdRewards,
			actualRewardsSent
		);
	}

	/**
	 * @notice helper to mint/send G$ rewards from fixed APY
	 * @param _account address of the staker
	 * @param _recipient address of G$ recipient
	 * @param _amount how much to mint/send
	 * @return actualSent how much rewards were actually minted/sent. If RewardsMinter is passed its limit it could be that not all requested amount was awarded.
	 */
	function _mintGDRewards(
		address _account,
		address _recipient,
		uint256 _amount
	) internal returns (uint256 actualSent) {
		//make sure RewardsMinter failure doesnt prevent withdrawl of stake
		//console.log("_mintGDRewards: sending amount: %s to: %s", _amount, _account);
		address minter = nameService.getAddress("MINTBURN_WRAPPER");
		if (minter != address(0)) {
			try
				RewardsMinter(nameService.getAddress("MINTBURN_WRAPPER")).sendOrMint(
					_recipient,
					_amount
				)
			returns (uint256 _res) {
				//console.log("sendOrMint result: %s", _res);
				actualSent = _res;
			} catch {
				//console.log("sendOrMint threw an error");
				actualSent = 0;
			}
		}

		//it could be that rewards minter doesnt have enough or passed cap
		//so we keep track of debt to user
		if (actualSent < _amount) {
			// console.log(
			// 	"Actually sent: %s, will undo %s",
			// 	actualSent,
			// 	_amount - actualSent
			// );
			uint256 shares = _undoReward(_account, _amount - actualSent);
			_increaseProductivity(address(this), _account, shares, 0, block.number); //increase productivity back for GOOD rewards
			_mint(_account, shares); //mint shares worth of undone rewards
			emit RewardsNotSent(_account, _amount, actualSent);
		}
	}

	/**
	 * @dev Stakers can withdraw their rewards without withdrawing their stake
	 * @return goodRewards recieved GOOD rewards
	 * @return gdRewards recieved G$ rewards
	 */
	function withdrawRewards()
		external
		returns (uint256 goodRewards, uint256 gdRewards)
	{
		uint256 gdRewardsShares = amountToShares(earned(msg.sender));

		//this will trigger a withdraw only of rewards part
		return withdrawStake(gdRewardsShares);
	}

	/**
	 * @dev Mint GOOD rewards of the staker
	 * @param user Receipent address of the rewards
	 * @return amount of the minted rewards
	 * emits 'ReputationEarned' event for staker earned GOOD amount
	 */
	function _mintGOODRewards(address user) internal returns (uint256 amount) {
		//try to mint only if have minter permission, so user can always withdraw his funds without this reverting
		if (
			nameService.getAddress("GDAO_STAKING") == address(this) ||
			AccessControl(nameService.getAddress("REPUTATION")).hasRole(
				keccak256("MINTER_ROLE"),
				address(this)
			)
		) {
			amount = _issueEarnedRewards(address(this), user, 0, block.number);
			if (amount > 0) {
				ERC20(nameService.getAddress("REPUTATION")).mint(user, amount);
				emit ReputationEarned(msg.sender, amount);
			}
		}
		return amount;
	}

	/**
	 * @dev Returns the number of decimals used for the staking reciept token precision
	 */
	function decimals() public view virtual override returns (uint8) {
		return 18; //SHARE_PERCISION
	}

	function sharesOf(address _account)
		public
		view
		virtual
		override
		returns (uint256)
	{
		return balanceOf(_account);
	}

	function sharesSupply() public view virtual override returns (uint256) {
		return totalSupply();
	}

	/**
	 * @dev override _transfer to handle rewards calculations when transfer the stake
	 * @notice transfer may fail if value < sharePrice()
	 */
	function _transfer(
		address from,
		address to,
		uint256 shares
	) internal override {
		_decreaseProductivity(address(this), from, shares, 0, block.number);
		//the recipient sent G$ are considered like he is staking them, so they will also earn GOOD rewards
		_increaseProductivity(address(this), to, shares, 0, block.number);

		//recipient inherits the rewards part also, this is important so deposit part is sent from contract balance and rewards from rewards contract
		uint256 recipientShares = balanceOf(to);
		stakersInfo[to].lastSharePrice = uint128(
			((stakersInfo[to].lastSharePrice * recipientShares) +
				(stakersInfo[from].lastSharePrice * shares)) /
				(recipientShares + shares)
		);

		//mint GOOD rewards
		_mintGOODRewards(from);
		_mintGOODRewards(to);

		super._transfer(from, to, shares);
	}

	/**
	 * @dev Calculate rewards per block from monthly amount of rewards and set it
	 * @param _monthlyAmount total rewards which will distribute monthly
	 */
	function setMonthlyGOODRewards(uint256 _monthlyAmount) external {
		_onlyAvatar();
		_setMonthlyRewards(address(this), _monthlyAmount);
		emit GOODRewardsSet(_monthlyAmount);
	}

	function setBlockPerYear(uint128 _blocksPerYear) external {
		_onlyAvatar();
		numberOfBlocksPerYear = _blocksPerYear;
	}

	/**
	 * @dev interest rate per one block in 1e18 precision.
	 * for example APY=5% then per block = nroot(1+0.05,numberOfBlocksPerYear)
	 * nroot(1.05,6000000) = 1.000000008131694
	 * in 1e18 = 1000000008131694000
	 * @param _interestRatePerBlock nth blocks per year root of APY - nroot(1+0.05,numberOfBlocksPerYear)
	 */
	function setGdApy(uint128 _interestRatePerBlock) public {
		_onlyAvatar();
		_setAPY(_interestRatePerBlock);
		require(
			Math64x64.mulu(
				Math64x64.pow(interestRatePerBlockX64, numberOfBlocksPerYear),
				1e4
			) < 12000
		);

		emit APYSet(_interestRatePerBlock);
	}

	/**
	 * @dev returns both GOOD and G$ rewards rate
	 * @return _goodRewardPerBlock GOOD nominal reward rate per block
	 * @return _gdInterestRatePerBlock the G$ interest rate  per block in 1e18 precision
	 */
	function getRewardsPerBlock()
		external
		view
		returns (uint256 _goodRewardPerBlock, uint256 _gdInterestRatePerBlock)
	{
		_goodRewardPerBlock = rewardsPerBlock[address(this)];
		_gdInterestRatePerBlock = Math64x64.mulu(interestRatePerBlockX64, 1e18);
	}

	/**
	 * @dev returns the user original deposit amount as registered in MultiBaseShare. should equal stakersInfo.deposit
	 * @return userStake user deposit amount
	 * @return totalStaked total deposits
	 */
	function getStaked(address _user)
		external
		view
		returns (uint256 userStake, uint256 totalStaked)
	{
		return getProductivity(address(this), _user);
	}

	/**
	 * @dev returns user pending GOOD and G$ rewards
	 * @return goodReward GOOD nominal rewards pending
	 * @return gdReward the G$ nominal rewards earned from interest rate
	 */
	function getUserPendingReward(address _user)
		external
		view
		returns (uint256 goodReward, uint256 gdReward)
	{
		// GOOD rewards
		goodReward = getUserPendingReward(address(this), 0, block.number, _user);

		gdReward = earned(_user);
	}

	/**
	 * @dev returns accumulated rewards per share
	 * @return _goodRewardPerShare GOOD accumulated rewards
	 * @return _gdRewardPerShare G$ accumulated rewards
	 */
	function totalRewardsPerShare()
		external
		view
		returns (uint256 _goodRewardPerShare, uint256 _gdRewardPerShare)
	{
		_goodRewardPerShare = super.totalRewardsPerShare(address(this));

		_gdRewardPerShare = totalSupply() == 0
			? 0
			: ((_compound() - stats.totalStaked * PRECISION) * SHARE_PRECISION) /
				(totalSupply() * PRECISION);
	}

	/// @dev helper function for multibase
	/// @return userInfo staker info related to GOOD rewards
	function goodStakerInfo(address _user)
		external
		view
		returns (UserInfo memory userInfo)
	{
		return contractToUsers[address(this)][_user];
	}

	/// @notice after 1 month move GOOD permissions minting to this contract from previous GovernanceStaking
	function upgrade() external virtual {
		require(
			block.timestamp > createdAt + (daysUntilUpgrade * 1 days) &&
				dao.isSchemeRegistered(address(this), avatar),
			"not deadline or not scheme"
		);
		_setMonthlyRewards(address(this), 2 ether * 1e6); //2M monthly GOOD
		emit GOODRewardsSet(2 ether * 1e6);

		//this will make sure rewards are set at 0, so no withdraw issue will happen.
		address curStaking = nameService.getAddress("GDAO_STAKING");
		bool ok;
		if (curStaking != address(0)) {
			//this will trigger updating of accumulated rewards, so everyone's rewards are updated to this point
			IGovernanceStaking(curStaking).withdrawRewards();
			(ok, ) = dao.genericCall(
				curStaking,
				abi.encodeWithSignature("setMonthlyRewards(uint256)", 0),
				avatar,
				0
			);
			require(ok, "calling setMonthlyRewards failed");
		}

		//this will set this contract as the GDAO_STAKING contract and give us minting rights on the reputation token
		(ok, ) = dao.genericCall(
			address(nameService),
			abi.encodeWithSignature(
				"setAddress(string,address)",
				"GDAO_STAKING",
				address(this)
			),
			avatar,
			0
		);
		require(ok, "calling setAddress failed");
		dao.unregisterSelf(avatar); // make sure we cant call this again;
	}

	/**
	 * @dev Pause staking and also set APY, usually when paused we want the APY to be 0
	 * updateReward is called to accrue interest until pause event
	 * @param _paused whether to pause on unpause
	 * @param _interestRatePerBlock the interest rate to set when pausing/unpausing (see setGdApy)
	 */
	function pause(bool _paused, uint128 _interestRatePerBlock)
		external
		updateReward
	{
		_onlyAvatar();
		if (_paused) {
			_pause();
		} else {
			_unpause();
		}
		setGdApy(_interestRatePerBlock);
	}

	/**
	 * @dev allow to withdraw the balance (principle+rewards) to a new staking contract
	 * @param _newStaking the addres of the new staking contract, needs to be a registered DAO scheme and implement IStakingUpgrade
	 */
	function upgradeTo(address _newStaking) external nonReentrant {
		//in case amount is 0 this will just withdraw the GOOD rewards, this is required for withdrawRewards
		uint256 _shares = sharesOf(msg.sender);
		require(_shares > 0, "no balance");

		//check that target contract was approved by the dao to prevent possible fraud
		require(
			dao.isSchemeRegistered(_newStaking, avatar),
			"not DAO approved upgrade"
		);

		(
			uint256 goodRewards,
			uint256 gdRewards,
			uint256 actualRewardsSent,
			uint256 depositComponent
		) = _withdrawStake(msg.sender, _newStaking, _shares);

		require(actualRewardsSent == gdRewards, "unable to mint rewards");

		//target new staking contract need to trust we transfered the tokens
		uint256 newShares = IStakingUpgrade(_newStaking).upgradeFrom(
			msg.sender,
			depositComponent + gdRewards
		);

		emit StakeUpgraded(
			msg.sender,
			depositComponent + actualRewardsSent,
			_shares,
			goodRewards,
			gdRewards,
			newShares
		);
	}
}
