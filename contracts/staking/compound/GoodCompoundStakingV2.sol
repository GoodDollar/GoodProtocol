// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../SimpleStakingV2.sol";
import "../../Interfaces.sol";
import "../UniswapV2SwapHelper.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Token
 * or withdraw their stake in Token
 * the contracts buy cToken and can transfer the daily interest to the  DAO
 */
contract GoodCompoundStakingV2 is SimpleStakingV2 {
	using UniswapV2SwapHelper for IHasRouter;

	// Address of the TOKEN/USD oracle from chainlink
	address tokenUsdOracle;
	//Address of the COMP/USD oracle from chianlink
	address compUsdOracle;

	// Gas cost to collect interest from this staking contract
	uint32 collectInterestGasCost;
	// Gas cost to collect COMP rewards
	uint32 compCollectGasCost;

	address[] tokenToDaiSwapPath;

	ERC20 comp;

	Uniswap uniswapContract;

	function getSettings()
		external
		view
		returns (uint32 _collectInterestGasCost, uint32 _compCollectGasCost)
	{
		return (collectInterestGasCost, compCollectGasCost);
	}

	/**
	 * @param _token Token to swap DEFI token
	 * @param _iToken DEFI token address
	 * @param _ns Address of the NameService
	 * @param _tokenName Name of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Symbol of the staking token which will be provided to staker for their staking share
	 * @param _maxRewardThreshold Determines blocks to pass for 1x Multiplier
	 * @param _tokenUsdOracle address of the TOKEN/USD oracle
	 * @param _compUsdOracle address of the COMP/USD oracle
	 * @param _tokenToDaiSwapPath the uniswap path to swap token to DAI, should be empty if token is DAI
	 */
	function init(
		address _token,
		address _iToken,
		INameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		address _compUsdOracle,
		address[] memory _tokenToDaiSwapPath
	) public {
		initialize(
			_token,
			_iToken,
			_ns,
			_tokenName,
			_tokenSymbol,
			_maxRewardThreshold
		);

		address dai = nameService.getAddress("DAI");
		require(
			_token == dai ||
				(_tokenToDaiSwapPath[0] == _token &&
					_tokenToDaiSwapPath[_tokenToDaiSwapPath.length - 1] == dai),
			"path"
		);

		//above  initialize going  to revert on second call, so this is safe
		compUsdOracle = _compUsdOracle;
		tokenUsdOracle = _tokenUsdOracle;
		tokenToDaiSwapPath = _tokenToDaiSwapPath;
		comp = ERC20(nameService.getAddress("COMP"));
		uniswapContract = Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
		collectInterestGasCost = 250000;
		compCollectGasCost = 150000;
		comp.approve(address(uniswapContract), type(uint256).max);
		token.approve(address(uniswapContract), type(uint256).max);
		token.approve(address(iToken), type(uint256).max); // approve the transfers to defi protocol as much as possible in order to save gas
	}

	/**
	 * @dev stake some Token
	 * @param _amount of Token to stake
	 */
	function mintInterestToken(uint256 _amount) internal override {
		require(cERC20(address(iToken)).mint(_amount) == 0, "minting");
	}

	/**
	 * @dev redeem Token from compound
	 * @param _amount of token to redeem in Token
	 */
	function redeem(uint256 _amount) internal override {
		require(cERC20(address(iToken)).redeemUnderlying(_amount) == 0, "redeem");
	}

	/**
	 * @dev Function to redeem cToken + reward COMP for DAI, so reserve knows how to handle it. (reserve can handle dai or cdai)
	 * @dev _amount of token in iToken
	 * @dev _recipient recipient of the DAI
	 * @return actualTokenGains amount of token redeemed for dai,
			actualRewardTokenGains amount of reward token redeemed for dai,
			daiAmount total dai received
	 */
	function redeemUnderlyingToDAI(uint256 _amount, address _recipient)
		internal
		override
		returns (
			uint256 actualTokenGains,
			uint256 actualRewardTokenGains,
			uint256 daiAmount
		)
	{
		uint256 compBalance = comp.balanceOf(address(this));

		uint256 redeemedDAI;

		if (compBalance > 0) {
			address[] memory compToDaiSwapPath = new address[](3);
			compToDaiSwapPath[0] = address(comp);
			compToDaiSwapPath[1] = uniswapContract.WETH();
			compToDaiSwapPath[2] = nameService.getAddress("DAI");
			actualRewardTokenGains = IHasRouter(this).maxSafeTokenAmount(
				address(comp),
				uniswapContract.WETH(),
				compBalance,
				maxLiquidityPercentageSwap
			);

			redeemedDAI = IHasRouter(this).swap(
				compToDaiSwapPath,
				actualRewardTokenGains,
				0,
				_recipient
			);
		}
		//in case of cdai there's no need to swap to DAI, we send cdai to reserve directly
		actualTokenGains = iTokenWorthInToken(_amount);
		if (address(iToken) == nameService.getAddress("CDAI")) {
			require(iToken.transfer(_recipient, _amount), "collect");
			return (
				actualTokenGains,
				actualRewardTokenGains,
				actualTokenGains + redeemedDAI
			); // If iToken is cDAI then just return cDAI
		}

		//out of requested interests to withdraw how much is it safe to swap
		uint256 safeAmount = IHasRouter(this).maxSafeTokenAmount(
			address(token),
			tokenToDaiSwapPath[1],
			actualTokenGains,
			maxLiquidityPercentageSwap
		);

		if (actualTokenGains > safeAmount) {
			actualTokenGains = safeAmount;
			//recalculate how much iToken to redeem
			_amount = tokenWorthIniToken(actualTokenGains);
		}

		require(cERC20(address(iToken)).redeem(_amount) == 0, "iredeem");

		actualTokenGains = token.balanceOf(address(this));

		if (actualTokenGains > 0) {
			redeemedDAI += IHasRouter(this).swap(
				tokenToDaiSwapPath,
				actualTokenGains,
				0,
				_recipient
			);
		}

		return (actualTokenGains, actualRewardTokenGains, redeemedDAI);
	}

	/**
	 * @dev returns decimals of token.
	 */
	function tokenDecimal() internal view override returns (uint256) {
		return uint256(ERC20(address(token)).decimals());
	}

	/**
	 * @dev returns decimals of interest token.
	 */
	function iTokenDecimal() internal view override returns (uint256) {
		return uint256(ERC20(address(iToken)).decimals());
	}

	/**
	 * @dev Function that calculates current interest gains of this staking contract
	 * @param _returnTokenBalanceInUSD determine return token balance of staking contract in USD
	 * @param _returnTokenGainsInUSD determine return token gains of staking contract in USD
	 * @return  iTokenGains gains in itoken, tokenGains gains in token, tokenBalance total locked Tokens, balanceInUsd locked tokens worth in USD, tokenGainsInUSD token Gains in USD
	 */
	function currentGains(
		bool _returnTokenBalanceInUSD,
		bool _returnTokenGainsInUSD
	)
		public
		view
		override
		returns (
			uint256 iTokenGains,
			uint256 tokenGains,
			uint256 tokenBalance,
			uint256 balanceInUSD,
			uint256 tokenGainsInUSD
		)
	{
		tokenBalance = iTokenWorthInToken(iToken.balanceOf(address(this)));
		balanceInUSD = _returnTokenBalanceInUSD
			? getTokenValueInUSD(tokenUsdOracle, tokenBalance, token.decimals())
			: 0;
		uint256 compValueInUSD = _returnTokenGainsInUSD
			? getTokenValueInUSD(
				compUsdOracle,
				comp.balanceOf(address(this)),
				18 // COMP is in 18 decimal
			)
			: 0;
		if (tokenBalance <= totalProductivity) {
			return (0, 0, tokenBalance, balanceInUSD, compValueInUSD);
		}

		tokenGains = tokenBalance - totalProductivity;
		tokenGainsInUSD = _returnTokenGainsInUSD
			? getTokenValueInUSD(tokenUsdOracle, tokenGains, token.decimals()) +
				compValueInUSD
			: 0;

		iTokenGains = tokenWorthIniToken(tokenGains);
	}

	/**
	 * @dev Function to get interest transfer cost for this particular staking contract
	 */
	function getGasCostForInterestTransfer()
		external
		view
		override
		returns (uint32)
	{
		uint256 compBalance = comp.balanceOf(address(this));
		if (compBalance > 0) return collectInterestGasCost + 200000; // need to make more check for this value

		return collectInterestGasCost;
	}

	/**
	 * @dev Calculates worth of given amount of iToken in Token
	 * @param _amount Amount of token to calculate worth in Token
	 * @return Worth of given amount of token in Token
	 */
	function iTokenWorthInToken(uint256 _amount)
		internal
		view
		override
		returns (uint256)
	{
		uint256 er = cERC20(address(iToken)).exchangeRateStored();
		(uint256 decimalDifference, bool caseType) = tokenDecimalPrecision();
		uint256 mantissa = 18 + tokenDecimal() - iTokenDecimal();
		uint256 tokenWorth = caseType == true
			? (_amount * (10**decimalDifference) * er) / 10**mantissa
			: ((_amount / (10**decimalDifference)) * er) / 10**mantissa; // calculation based on https://compound.finance/docs#protocol-math
		return tokenWorth;
	}

	/**
	 * @dev Calculates worth of given amount of token in iToken
	 * @param _amount Amount of iToken to calculate worth in token
	 * @return tokenWorth Worth of given amount of token in iToken
	 */
	function tokenWorthIniToken(uint256 _amount)
		public
		view
		returns (uint256 tokenWorth)
	{
		uint256 er = cERC20(address(iToken)).exchangeRateStored();
		(uint256 decimalDifference, bool caseType) = tokenDecimalPrecision();
		uint256 mantissa = 18 + tokenDecimal() - iTokenDecimal();
		tokenWorth = caseType == true
			? ((_amount / (10**decimalDifference)) * 10**mantissa) / er
			: ((_amount * (10**decimalDifference)) * 10**mantissa) / er; // calculation based on https://compound.finance/docs#protocol-math
	}

	/**
	 * @dev Set Gas cost to interest collection for this contract
	 * @param _collectInterestGasCost Gas cost to collect interest
	 * @param _rewardTokenCollectCost gas cost to collect reward tokens
	 */
	function setcollectInterestGasCostParams(
		uint32 _collectInterestGasCost,
		uint32 _rewardTokenCollectCost
	) external {
		_onlyAvatar();
		collectInterestGasCost = _collectInterestGasCost;
		compCollectGasCost = _rewardTokenCollectCost;
	}
}
