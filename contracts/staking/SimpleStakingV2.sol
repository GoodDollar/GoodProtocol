// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "../Interfaces.sol";
import "../DAOStackInterfaces.sol";
import "../utils/NameService.sol";
import "../utils/DAOContract.sol";
import "./GoodFundManager.sol";
import "./BaseShareFieldV2.sol";
import "../governance/StakersDistribution.sol";
import "./UniswapV2SwapHelper.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Tokens
 * or withdraw their stake in Tokens
 * the FundManager can request to receive the interest
 */
abstract contract SimpleStakingV2 is
	ERC20Upgradeable,
	DAOContract,
	BaseShareFieldV2,
	ReentrancyGuardUpgradeable,
	IHasRouter
{
	// Token address
	ERC20 public token;
	// Interest Token address
	ERC20 public iToken;

	// emergency pause
	bool public isPaused;

	//max percentage of token/dai pool liquidity to swap to DAI when collecting interest out of 100000
	uint24 public maxLiquidityPercentageSwap;

	uint256 public lockedUSDValue;

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
		uint256 iTokenGains, // interest accrued
		uint256 tokenGains, // interest worth in underlying token value
		uint256 actualTokenRedeemed, //actual token redeemed in uniswap (max 0.3% of liquidity) to DAI
		uint256 actualRewardTokenEarned, //actual reward token earned
		uint256 interestCollectedInDAI //actual dai sent to the reserve as interest from converting token and optionally reward token in uniswap
	);

	/**
	 * @dev Constructor
	 * @param _token The address of Token
	 * @param _iToken The address of Interest Token
	 * @param _ns The address of the INameService contract
	 * @param _tokenName The name of the staking token
	 * @param _tokenSymbol The symbol of the staking token
	 * @param _maxRewardThreshold the blocks that should pass to get 1x reward multiplier

	 */
	function initialize(
		address _token,
		address _iToken,
		INameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold
	) public virtual initializer {
		setDAO(_ns);
		token = ERC20(_token);
		iToken = ERC20(_iToken);
		__ERC20_init(_tokenName, _tokenSymbol);
		require(token.decimals() <= 18, "decimals");
		tokenDecimalDifference = 18 - token.decimals();
		maxMultiplierThreshold = _maxRewardThreshold;
		maxLiquidityPercentageSwap = 300; //0.3%
	}

	function setMaxLiquidityPercentageSwap(uint24 _maxPercentage) public virtual {
		_onlyAvatar();
		maxLiquidityPercentageSwap = _maxPercentage;
	}

	/**
	 * @dev Calculates worth of given amount of iToken in Token
	 * @param _amount Amount of iToken to calculate worth in Token
	 * @return Worth of given amount of iToken in Token
	 */
	function iTokenWorthInToken(uint256 _amount)
		internal
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
	 * @param _amount tokens to be redeemed.
	 */
	function redeem(uint256 _amount) internal virtual;

	/**
	 * @dev Redeem invested underlying tokens from defi protocol and exchange into DAI
	 * @param _amount tokens to be redeemed
	 * @return amount of token swapped to dai, amount of reward token swapped to dai, total dai
	 */
	function redeemUnderlyingToDAI(uint256 _amount, address _recipient)
		internal
		virtual
		returns (
			uint256,
			uint256,
			uint256
		);

	/**
	 * @dev Invests staked tokens to defi protocol.
	 * @param _amount tokens staked.
	 */
	function mintInterestToken(uint256 _amount) internal virtual;

	/**
	 * @dev Function that calculates current interest gains of this staking contract
	 * @param _returnTokenBalanceInUSD determine return token balance of staking contract in USD
	 * @param _returnTokenGainsInUSD determine return token gains of staking contract in USD
	 * @return return gains in itoken,Token and worth of total locked Tokens,token balance in USD (8 decimals),token Gains in USD (8 decimals)
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
	) external virtual nonReentrant {
		require(isPaused == false, "Staking is paused");
		require(_donationPer == 0 || _donationPer == 100, "donationPer");
		require(_amount > 0, "amount");
		require(
			(_inInterestToken ? iToken : token).transferFrom(
				_msgSender(),
				address(this),
				_amount
			),
			"approve"
		);
		_amount = _inInterestToken ? iTokenWorthInToken(_amount) : _amount;
		if (_inInterestToken == false) {
			mintInterestToken(_amount); //mint iToken
		}
		_mint(_msgSender(), _amount); // mint Staking token for staker
		(
			uint32 rewardsPerBlock,
			uint64 blockStart,
			uint64 blockEnd,

		) = GoodFundManager(nameService.getAddress("FUND_MANAGER"))
				.rewardsForStakingContract(address(this));
		_increaseProductivity(
			_msgSender(),
			_amount,
			rewardsPerBlock,
			blockStart,
			blockEnd,
			_donationPer
		);

		(, , , uint256 lockedValueInUSD, ) = currentGains(true, false);
		lockedUSDValue = lockedValueInUSD;

		//notify GDAO distrbution for stakers
		StakersDistribution sd = StakersDistribution(
			nameService.getAddress("GDAO_STAKERS")
		);
		if (address(sd) != address(0)) {
			sd.userStaked(_msgSender(), _convertValueTo18Decimals(_amount));
		}

		emit Staked(_msgSender(), address(token), _amount);
	}

	/**
	 * @dev Withdraws the sender staked Token.
	 * @param _amount Amount to withdraw in Token or iToken
	 * @param _inInterestToken if true _amount is in iToken and also returned in iToken other wise use Token
	 */
	function withdrawStake(uint256 _amount, bool _inInterestToken)
		external
		virtual
		nonReentrant
	{
		uint256 tokenWithdraw;

		if (_inInterestToken) {
			uint256 tokenWorth = iTokenWorthInToken(_amount);
			require(iToken.transfer(_msgSender(), _amount), "iWithdraw");
			tokenWithdraw = _amount = tokenWorth;
		} else {
			tokenWithdraw = _amount;
			redeem(tokenWithdraw);

			//this is required for redeem precision loss
			uint256 tokenActual = token.balanceOf(address(this));
			if (tokenActual < tokenWithdraw) {
				tokenWithdraw = tokenActual;
			}
			require(token.transfer(_msgSender(), tokenWithdraw), "withdraw");
		}

		GoodFundManager fm = GoodFundManager(
			nameService.getAddress("FUND_MANAGER")
		);

		(, , , uint256 lockedValueInUSD, ) = currentGains(true, false);
		lockedUSDValue = lockedValueInUSD;

		//this will revert in case user doesnt have enough productivity to withdraw _amount, as productivity=staking tokens amount
		_burn(msg.sender, _amount); // burn their staking tokens

		(uint32 rewardsPerBlock, uint64 blockStart, uint64 blockEnd, ) = fm
			.rewardsForStakingContract(address(this));

		_decreaseProductivity(
			_msgSender(),
			_amount,
			rewardsPerBlock,
			blockStart,
			blockEnd
		);
		fm.mintReward(nameService.getAddress("CDAI"), _msgSender()); // send rewards to user and use cDAI address since reserve in cDAI

		//notify GDAO distrbution for stakers
		StakersDistribution sd = StakersDistribution(
			nameService.getAddress("GDAO_STAKERS")
		);
		if (address(sd) != address(0)) {
			sd.userWithdraw(_msgSender(), _convertValueTo18Decimals(_amount));
		}

		emit StakeWithdraw(msg.sender, address(token), tokenWithdraw);
	}

	/**
	 * @dev withdraw staker G$ rewards + GDAO rewards
	 * withdrawing rewards resets the multiplier! so if user just want GDAO he should use claimReputation()
	 */
	function withdrawRewards() external nonReentrant {
		GoodFundManager(nameService.getAddress("FUND_MANAGER")).mintReward(
			nameService.getAddress("CDAI"),
			_msgSender()
		); // send rewards to user and use cDAI address since reserve in cDAI
		claimReputation();
	}

	/**
	 * @dev withdraw staker GDAO rewards
	 */
	function claimReputation() public {
		//claim reputation rewards
		StakersDistribution sd = StakersDistribution(
			nameService.getAddress("GDAO_STAKERS")
		);
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
		address _from,
		address _to,
		uint256 _value
	) internal override {
		super._transfer(_from, _to, _value);
		StakersDistribution sd = StakersDistribution(
			nameService.getAddress("GDAO_STAKERS")
		);
		(
			uint32 rewardsPerBlock,
			uint64 blockStart,
			uint64 blockEnd,

		) = GoodFundManager(nameService.getAddress("FUND_MANAGER"))
				.rewardsForStakingContract(address(this));

		_decreaseProductivity(_from, _value, rewardsPerBlock, blockStart, blockEnd);

		_increaseProductivity(
			_to,
			_value,
			rewardsPerBlock,
			blockStart,
			blockEnd,
			0
		);

		if (address(sd) != address(0)) {
			uint256 _convertedValue = _convertValueTo18Decimals(_value);
			sd.userWithdraw(_from, _convertedValue);
			sd.userStaked(_to, _convertedValue);
		}
	}

	function _convertValueTo18Decimals(uint256 _amount)
		internal
		view
		returns (uint256 amountInEighteenDecimals)
	{
		amountInEighteenDecimals = token.decimals() == 18
			? _amount
			: _amount * 10**(18 - token.decimals());
	}

	// @dev To find difference in token's decimal and iToken's decimal
	// @return difference in decimals.
	// @return true if token's decimal is more than iToken's
	function tokenDecimalPrecision() internal view returns (uint256, bool) {
		uint256 _tokenDecimal = tokenDecimal();
		uint256 _iTokenDecimal = iTokenDecimal();
		uint256 decimalDifference = _tokenDecimal > _iTokenDecimal
			? _tokenDecimal - _iTokenDecimal
			: _iTokenDecimal - _tokenDecimal;
		return (decimalDifference, _tokenDecimal > _iTokenDecimal);
	}

	/**
	 * @dev Collects gained interest by fundmanager.
	 * @param _recipient The recipient of cDAI gains
	 * @return actualTokenRedeemed  actualRewardTokenRedeemed actualDai collected interest from token,
	 * collected interest from reward token, total DAI received from swapping token+reward token
	 */
	function collectUBIInterest(address _recipient)
		public
		virtual
		returns (
			uint256 actualTokenRedeemed,
			uint256 actualRewardTokenRedeemed,
			uint256 actualDai
		)
	{
		_canMintRewards();

		(uint256 iTokenGains, uint256 tokenGains, , , ) = currentGains(
			false,
			false
		);

		(
			actualTokenRedeemed,
			actualRewardTokenRedeemed,
			actualDai
		) = redeemUnderlyingToDAI(iTokenGains, _recipient);

		emit InterestCollected(
			_recipient,
			iTokenGains,
			tokenGains,
			actualTokenRedeemed,
			actualRewardTokenRedeemed,
			actualDai
		);
	}

	/**
	 * @dev making the contract inactive
	 * NOTICE: this could theoretically result in future interest earned in cdai to remain locked
	 */
	function pause(bool _isPaused) public {
		_onlyAvatar();
		isPaused = _isPaused;
	}

	/**
	 * @dev method to recover any stuck ERC20 tokens (ie  compound COMP)
	 * @param _token the ERC20 token to recover
	 */
	function recover(ERC20 _token) public {
		_onlyAvatar();
		uint256 toWithdraw = _token.balanceOf(address(this));

		// recover left iToken(stakers token) only when all stakes have been withdrawn
		if (address(_token) == address(iToken)) {
			require(totalProductivity == 0 && isPaused, "recover");
		}
		require(_token.transfer(address(avatar), toWithdraw), "transfer");
	}

	/**
	 @dev function calculate Token price in USD
 	 @param _oracle chainlink oracle usd/token oralce
	 @param _amount Amount of Token to calculate worth of it
	 @param _decimals decimals of Token
	 @return Returns worth of Tokens in USD
	 */
	function getTokenValueInUSD(
		address _oracle,
		uint256 _amount,
		uint256 _decimals
	) public view returns (uint256) {
		AggregatorV3Interface tokenPriceOracle = AggregatorV3Interface(_oracle);
		int256 tokenPriceinUSD = tokenPriceOracle.latestAnswer();
		return (uint256(tokenPriceinUSD) * _amount) / (10**_decimals); // tokenPriceinUSD in 8 decimals and _amount is in Token's decimals so we divide it to Token's decimal at the end to reduce 8 decimals back
	}

	function _canMintRewards() internal view override {
		require(_msgSender() == nameService.getAddress("FUND_MANAGER"), "fund");
	}

	function decimals() public view virtual override returns (uint8) {
		return token.decimals();
	}

	/**
	 * @param _staker account to get rewards status for
	 * @return (minted, pending) in G$ 2 decimals
	 */
	function getUserMintedAndPending(address _staker)
		external
		view
		returns (uint256, uint256)
	{
		(
			uint32 rewardsPerBlock,
			uint64 blockStart,
			uint64 blockEnd,

		) = GoodFundManager(nameService.getAddress("FUND_MANAGER"))
				.rewardsForStakingContract(address(this));

		uint256 pending = getUserPendingReward(
			_staker,
			rewardsPerBlock,
			blockStart,
			blockEnd
		);

		//divide by 1e16 to return in 2 decimals
		return (users[_staker].rewardMinted / 1e16, pending / 1e16);
	}

	function getRouter() public view override returns (Uniswap) {
		return Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
	}
}
