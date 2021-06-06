// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "../Interfaces.sol";

import "../DAOStackInterfaces.sol";
import "../utils/NameService.sol";
import "../utils/DAOContract.sol";
import "./GoodFundManager.sol";
import "./BaseShareField.sol";
import "../governance/StakersDistribution.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Tokens
 * or withdraw their stake in Tokens
 * the contracts buy intrest tokens and can transfer the daily interest to the  DAO
 */
abstract contract SimpleStaking is
	ERC20Upgradeable,
	DAOContract,
	BaseShareField,
	ReentrancyGuardUpgradeable
{
	// Token address
	ERC20 public token;
	// Interest Token address
	ERC20 public iToken;

	// Interest and staker data
	//InterestDistribution.InterestData public interestData;

	// Gas cost to collect interest from this staking contract
	uint32 public collectInterestGasCost;

	// The total staked Token amount in the contract
	// uint256 public totalStaked = 0;
	uint8 public stakingTokenDecimals;
	bool public isPaused;
	/**
	 * @dev Emitted when `staker` stake `value` tokens of `token`
	 */
	event Staked(address indexed staker, address token, uint256 value);

	/**
	 * @dev Emitted when `staker` withdraws their stake `value` tokens and contracts balance will
	 * be reduced to`remainingBalance`.
	 */
	event StakeWithdraw(address indexed staker, address token, uint256 value);

	/**
	 * @dev Emitted when fundmanager transfers intrest collected from defi protrocol.
	 * `recipient` will receive `intrestTokenValue` as intrest.
	 */
	event InterestCollected(
		address recipient,
		uint256 iTokenAmount,
		uint256 tokenAmount,
		uint256 usdValue
	);

	/**
	 * @dev Constructor
	 * @param _token The address of Token
	 * @param _iToken The address of Interest Token
	 * @param _ns The address of the NameService contract
	 * @param _tokenName The name of the staking token
	 * @param _tokenSymbol The symbol of the staking token
	 * @param _maxRewardThreshold the blocks that should pass to get 1x reward multiplier
	 * @param _collectInterestGasCost Gas cost for the collect interest of this staking contract
	 */
	function initialize(
		address _token,
		address _iToken,
		NameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold,
		uint32 _collectInterestGasCost
	) public virtual initializer {
		setDAO(_ns);
		token = ERC20(_token);
		iToken = ERC20(_iToken);
		__ERC20_init(_tokenName, _tokenSymbol);
		require(
			token.decimals() <= 18,
			"Token decimals should be less than 18 decimals"
		);
		stakingTokenDecimals = token.decimals();
		tokenDecimalDifference = 18 - token.decimals();
		maxMultiplierThreshold = _maxRewardThreshold;
		collectInterestGasCost = _collectInterestGasCost; // Should be adjusted according to this contract's gas cost

		token.approve(address(iToken), type(uint256).max); // approve the transfers to defi protocol as much as possible in order to save gas
	}

	/**
	 * @dev Set Gas cost to interest collection for this contract
	 * @param _amount Gas cost to collect interest
	 */
	function setcollectInterestGasCost(uint32 _amount) external {
		_onlyAvatar();
		collectInterestGasCost = _amount;
	}

	/**
	 * @dev Calculates worth of given amount of iToken in Token
	 * @param _amount Amount of iToken to calculate worth in Token
	 * @return Worth of given amount of iToken in Token
	 */
	function iTokenWorthInToken(uint256 _amount)
		public
		view
		virtual
		returns (uint256);

	/**
	 * @dev Get gas cost for interest transfer so can be used in the calculation of collectable interest for particular gas amount
	 * @return returns hardcoded gas cost
	 */
	function getGasCostForInterestTransfer()
		external
		view
		virtual
		returns (uint32);

	/**
	 * @dev Returns decimal value for token.
	 */
	function tokenDecimal() internal view virtual returns (uint256);

	/**
	 * @dev Returns decimal value for intrest token.
	 */
	function iTokenDecimal() internal view virtual returns (uint256);

	/**
	 * @dev Redeem invested tokens from defi protocol.
	 * @param amount tokens to be redeemed.
	 */
	function redeem(uint256 amount) internal virtual;

	/**
	 * @dev Redeem invested underlying tokens from defi protocol
	 * @dev amount tokens to be redeemed
	 * @return token which redeemed from protocol and redeemed amount
	 */
	function redeemUnderlyingToDAI(uint256 _amount)
		internal
		virtual
		returns (address, uint256);

	/**
	 * @dev Invests staked tokens to defi protocol.
	 * @param amount tokens staked.
	 */
	function mintInterestToken(uint256 amount) internal virtual;

	/**
	 * @dev Function that calculates current interest gains of this staking contract
	 * @param _returnTokenBalanceInUSD determine return token balance of staking contract in USD
	 * @param _returnTokenGainsInUSD determine return token gains of staking contract in USD
	 * @return return gains in itoken,Token and worth of total locked Tokens,token balance in USD,token Gains in USD
	 */
	function currentGains(
		bool _returnTokenBalanceInUSD,
		bool _returnTokenGainsInUSD
	)
		public
		view
		virtual
		returns (
			uint256,
			uint256,
			uint256,
			uint256,
			uint256
		);

	/**
	 * @dev Allows a staker to deposit Tokens. Notice that `approve` is
	 * needed to be executed before the execution of this method.
	 * Can be executed only when the contract is not paused.
	 * @param _amount The amount of Token or iToken to stake (it depends on _inInterestToken parameter)
	 * @param _donationPer The % of interest staker want to donate.
	 * @param _inInterestToken specificy if stake in iToken or Token
	 */
	function stake(
		uint256 _amount,
		uint256 _donationPer,
		bool _inInterestToken
	) external virtual {
		require(isPaused == false, "Staking is paused");
		require(
			_donationPer == 0 || _donationPer == 100,
			"Donation percentage should be 0 or 100"
		);
		require(_amount > 0, "You need to stake a positive token amount");
		require(
			(_inInterestToken ? iToken : token).transferFrom(
				_msgSender(),
				address(this),
				_amount
			),
			"transferFrom failed, make sure you approved token transfer"
		);
		_amount = _inInterestToken ? iTokenWorthInToken(_amount) : _amount;
		if (_inInterestToken == false) {
			mintInterestToken(_amount); //mint iToken
		}

		UserInfo storage userInfo = users[_msgSender()];
		userInfo.donationPer = uint8(_donationPer);

		_mint(_msgSender(), _amount); // mint Staking token for staker
		(uint32 rewardsPerBlock, uint64 blockStart, uint64 blockEnd, ) =
			GoodFundManager(nameService.getAddress("FUND_MANAGER"))
				.rewardsForStakingContract(address(this));
		_increaseProductivity(
			_msgSender(),
			_amount,
			rewardsPerBlock,
			blockStart,
			blockEnd
		);

		//notify GDAO distrbution for stakers
		StakersDistribution sd =
			StakersDistribution(nameService.getAddress("GDAO_STAKERS"));
		if (address(sd) != address(0)) {
			uint256 stakeAmountInEighteenDecimals =
				token.decimals() == 18
					? _amount
					: _amount * 10**(18 - token.decimals());
			sd.userStaked(_msgSender(), stakeAmountInEighteenDecimals);
		}

		emit Staked(_msgSender(), address(token), _amount);
	}

	/**
	 * @dev Withdraws the sender staked Token.
	 * @dev _amount Amount to withdraw in Token or iToken
	 * @param _inInterestToken if true_amount is in iToken and also returned in iToken other wise use Token
	 */
	function withdrawStake(uint256 _amount, bool _inInterestToken)
		external
		virtual
		nonReentrant
	{
		uint256 tokenWithdraw;
		(uint256 userProductivity, ) = getProductivity(msg.sender);

		if (_inInterestToken) {
			uint256 tokenWorth = iTokenWorthInToken(_amount);
			require(
				iToken.transfer(_msgSender(), _amount),
				"withdraw transfer failed"
			);
			tokenWithdraw = _amount = tokenWorth;
		} else {
			tokenWithdraw = _amount;
			redeem(tokenWithdraw);

			//this is required for redeem precision loss
			uint256 tokenActual = token.balanceOf(address(this));
			if (tokenActual < tokenWithdraw) {
				tokenWithdraw = tokenActual;
			}
			require(
				token.transfer(_msgSender(), tokenWithdraw),
				"withdraw transfer failed"
			);
		}

		GoodFundManager fm =
			GoodFundManager(nameService.getAddress("FUND_MANAGER"));

		//this will revert in case user doesnt have enough productivity to withdraw _amount, as productivity=staking tokens amount
		_burn(msg.sender, _amount); // burn their staking tokens

		(uint32 rewardsPerBlock, uint64 blockStart, uint64 blockEnd, ) =
			fm.rewardsForStakingContract(address(this));

		_decreaseProductivity(
			_msgSender(),
			_amount,
			rewardsPerBlock,
			blockStart,
			blockEnd
		);
		fm.mintReward(nameService.getAddress("CDAI"), _msgSender()); // send rewards to user and use cDAI address since reserve in cDAI

		//notify GDAO distrbution for stakers
		StakersDistribution sd =
			StakersDistribution(nameService.getAddress("GDAO_STAKERS"));
		if (address(sd) != address(0)) {
			uint256 withdrawAmountInEighteenDecimals =
				token.decimals() == 18
					? _amount
					: _amount * 10**(18 - token.decimals());
			sd.userWithdraw(_msgSender(), withdrawAmountInEighteenDecimals);
		}

		emit StakeWithdraw(msg.sender, address(token), tokenWithdraw);
	}

	/**
	 * @dev withdraw staker G$ rewards + GDAO rewards
	 * withdrawing rewards resets the multiplier! so if user just want GDAO he should use claimReputation()
	 */
	function withdrawRewards() external nonReentrant {
		GoodFundManager fm =
			GoodFundManager(nameService.getAddress("FUND_MANAGER"));
		fm.mintReward(nameService.getAddress("CDAI"), _msgSender()); // send rewards to user and use cDAI address since reserve in cDAI
		claimReputation();
	}

	/**
	 * @dev withdraw staker GDAO rewards
	 */
	function claimReputation() public {
		//claim reputation rewards
		StakersDistribution sd =
			StakersDistribution(nameService.getAddress("GDAO_STAKERS"));
		if (address(sd) != address(0)) {
			address[] memory contracts = new address[](1);
			contracts[0] = (address(this));
			sd.claimReputation(_msgSender(), contracts);
		}
	}

	/**
	 * @dev notify stakersdistribution when user performs transfer operation
	 */
	function _transfer(
		address from,
		address to,
		uint256 value
	) internal override {
		super._transfer(from, to, value);

		StakersDistribution sd =
			StakersDistribution(nameService.getAddress("GDAO_STAKERS"));
		(uint32 rewardsPerBlock, uint64 blockStart, uint64 blockEnd, ) =
			GoodFundManager(nameService.getAddress("FUND_MANAGER"))
				.rewardsForStakingContract(address(this));
		_decreaseProductivity(
			from,
			value,
			rewardsPerBlock,
			blockStart,
			blockEnd
		);
		_increaseProductivity(to, value, rewardsPerBlock, blockStart, blockEnd);
		if (address(sd) != address(0)) {
			address[] memory contracts;
			contracts[0] = (address(this));
			sd.userWithdraw(from, value);
			sd.userStaked(to, value);
			sd.claimReputation(to, contracts);
			sd.claimReputation(from, contracts);
		}
	}

	// @dev To find difference in token's decimal and iToken's decimal
	// @return difference in decimals.
	// @return true if token's decimal is more than iToken's
	function tokenDecimalPrecision() internal view returns (uint256, bool) {
		uint256 tokenDecimal = tokenDecimal();
		uint256 iTokenDecimal = iTokenDecimal();
		uint256 decimalDifference =
			tokenDecimal > iTokenDecimal
				? tokenDecimal - iTokenDecimal
				: iTokenDecimal - tokenDecimal;
		return (decimalDifference, tokenDecimal > iTokenDecimal);
	}

	function getStakerData(address _staker)
		public
		view
		returns (
			uint256,
			uint256,
			uint256,
			uint256
		)
	{
		return (
			users[_staker].amount,
			users[_staker].rewardDebt,
			users[_staker].rewardEarn,
			users[_staker].lastRewardTime
		);
	}

	/**
	 * @dev Collects gained interest by fundmanager. Can be collected only once
	 * in an interval which is defined above.
	 * @param _recipient The recipient of cDAI gains
	 * @return (uint256, uint256) The interest in iToken, the interest in Token
	 */
	function collectUBIInterest(address _recipient)
		public
		virtual
		returns (
			uint256,
			uint256,
			uint256
		)
	{
		_canMintRewards();
		// otherwise fund manager has to wait for the next interval
		require(
			_recipient != address(this),
			"Recipient cannot be the staking contract"
		);
		(uint256 iTokenGains, uint256 tokenGains, , , uint256 usdGains) =
			currentGains(false, true);

		(address redeemedToken, uint256 redeemedAmount) =
			redeemUnderlyingToDAI(iTokenGains);
		if (redeemedAmount > 0)
			require(
				ERC20(redeemedToken).transfer(_recipient, redeemedAmount),
				"collect transfer failed"
			);

		emit InterestCollected(_recipient, iTokenGains, tokenGains, usdGains);
		return (iTokenGains, tokenGains, usdGains);
	}

	/**
	 * @dev making the contract inactive
	 * NOTICE: this could theoretically result in future interest earned in cdai to remain locked
	 * but we dont expect any other stakers but us in SimpleDAIStaking
	 */
	function pause(bool _isPaused) public {
		_onlyAvatar();
		isPaused = _isPaused;
	}

	/**
	 * @dev method to recover any stuck erc20 tokens (ie  compound COMP)
	 * @param _token the ERC20 token to recover
	 */
	function recover(ERC20 _token) public {
		_onlyAvatar();
		uint256 toWithdraw = _token.balanceOf(address(this));

		// recover left iToken(stakers token) only when all stakes have been withdrawn
		if (address(_token) == address(iToken)) {
			require(
				totalProductivity == 0 && isPaused,
				"can recover iToken only when stakes have been withdrawn"
			);
		}
		require(
			_token.transfer(address(avatar), toWithdraw),
			"recover transfer failed"
		);
	}

	/**
	 @dev function calculate Token price in USD 
	 @dev _amount Amount of Token to calculate worth of it
	 @return Returns worth of Tokens in USD
	 */
	function getTokenValueInUSD(address _oracle, uint256 _amount)
		public
		view
		returns (uint256)
	{
		AggregatorV3Interface tokenPriceOracle = AggregatorV3Interface(_oracle);
		int256 tokenPriceinUSD = tokenPriceOracle.latestAnswer();
		return (uint256(tokenPriceinUSD) * _amount) / (10**token.decimals()); // tokenPriceinUSD in 8 decimals and _amount is in Token's decimals so we divide it to Token's decimal at the end to reduce 8 decimals back
	}

	function _canMintRewards() internal view override {
		require(
			_msgSender() == nameService.getAddress("FUND_MANAGER"),
			"Only FundManager can call this method"
		);
	}

	function decimals() public view virtual override returns (uint8) {
		return stakingTokenDecimals;
	}
}
