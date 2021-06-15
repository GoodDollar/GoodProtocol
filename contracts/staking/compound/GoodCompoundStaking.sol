// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../SimpleStaking.sol";
import "../../Interfaces.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Token
 * or withdraw their stake in Token
 * the contracts buy cToken and can transfer the daily interest to the  DAO
 */
contract GoodCompoundStaking is SimpleStaking {
	// Address of the TOKEN/USD oracle from chainlink
	address public tokenUsdOracle;
	//Address of the COMP/USD oracle from chianlink
	address public compUsdOracle;

	// Gas cost to collect interest from this staking contract
	uint32 public collectInterestGasCost = 250000;
	// Gas cost to collect COMP rewards
	uint32 public compCollectGasCost = 150000;
	/**
	 * @param _token Token to swap DEFI token
	 * @param _iToken DEFI token address
	 * @param _ns Address of the NameService
	 * @param _tokenName Name of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Symbol of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Determines blocks to pass for 1x Multiplier
	 * @param _tokenUsdOracle address of the TOKEN/USD oracle
	 * @param _compUsdOracle address of the COMP/USD oracle

	 */
	function init(
		address _token,
		address _iToken,
		INameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		address _compUsdOracle
	) public {
		initialize(
			_token,
			_iToken,
			_ns,
			_tokenName,
			_tokenSymbol,
			_maxRewardThreshold
		);
		//above  initialize going  to revert on second call, so this is safe
		compUsdOracle = _compUsdOracle;
		tokenUsdOracle = _tokenUsdOracle;
		_approveTokens();
	}

	/**
	 * @dev stake some Token
	 * @param _amount of Token to stake
	 */
	function mintInterestToken(uint256 _amount) internal override {
		cERC20 cToken = cERC20(address(iToken));
		require(
			cToken.mint(_amount) == 0,
			"Minting cToken failed, funds returned"
		);
	}

	/**
	 * @dev redeem Token from compound
	 * @param _amount of token to redeem in Token
	 */
	function redeem(uint256 _amount) internal override {
		cERC20 cToken = cERC20(address(iToken));
		require(
			cToken.redeemUnderlying(_amount) == 0,
			"Failed to redeem cToken"
		);
	}

	/**
	 * @dev Function to redeem cToken for DAI, so reserve knows how to handle it. (reserve can handle dai or cdai)
	 * @dev _amount of token in iToken
	 * @dev _recipient recipient of the DAI
	 * @return return address of the DAI and amount of the DAI
	 */
	function redeemUnderlyingToDAI(uint256 _amount, address _recipient)
		internal
		override
		returns (address, uint256)
	{
		ERC20 comp = ERC20(nameService.getAddress("COMP"));
		uint256 compBalance = comp.balanceOf(address(this));
		address daiAddress = nameService.getAddress("DAI");
		Uniswap uniswapContract =
			Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
		uint256 daiFromComp;
		cERC20 cToken = cERC20(address(iToken));
		address[] memory path = new address[](2);
		if (compBalance > 0) {
			path[0] = address(comp);
			path[1] = daiAddress;
			uint256[] memory compSwap =
				uniswapContract.swapExactTokensForTokens(
					compBalance,
					0,
					path,
					 _recipient,
					block.timestamp
				);
			daiFromComp = compSwap[1];
		}
		if (address(iToken) == nameService.getAddress("CDAI")) {
			return (address(iToken), _amount); // If iToken is cDAI then just return cDAI
		}
		require(cToken.redeem(_amount) == 0, "Failed to redeem cToken");
		uint256 redeemedAmount = token.balanceOf(address(this));
		uint256 dai;
		address recipientTemp = _recipient;
		if (redeemedAmount > 0) {
			path[0] = address(token);
			path[1] = daiAddress;
			uint256[] memory swap =
				uniswapContract.swapExactTokensForTokens(
					redeemedAmount,
					0,
					path,
					recipientTemp,
					block.timestamp
				);
			dai = swap[1];
		}

		return (daiAddress, dai + daiFromComp);
	}

	/**
	 * @dev returns decimals of token.
	 */
	function tokenDecimal() internal view override returns (uint256) {
		ERC20 token = ERC20(address(token));
		return uint256(token.decimals());
	}

	/**
	 * @dev returns decimals of interest token.
	 */
	function iTokenDecimal() internal view override returns (uint256) {
		ERC20 cToken = ERC20(address(iToken));
		return uint256(cToken.decimals());
	}
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
		override
		returns (
			uint256,
			uint256,
			uint256,
			uint256,
			uint256
		)
	{
		cERC20 cToken = cERC20(address(iToken));
		uint256 er = cToken.exchangeRateStored();
		(uint256 decimalDifference, bool caseType) = tokenDecimalPrecision();
		uint256 mantissa = 18 + tokenDecimal() - iTokenDecimal();
		uint256 tokenBalance =
			iTokenWorthInToken(iToken.balanceOf(address(this)));
		uint256 balanceInUSD =
			_returnTokenBalanceInUSD
				? getTokenValueInUSD(tokenUsdOracle, tokenBalance,token.decimals())
				: 0;
		uint256 compValueInUSD =
			_returnTokenGainsInUSD
				? getTokenValueInUSD(
					compUsdOracle,
					ERC20(nameService.getAddress("COMP")).balanceOf(
						address(this)
					),18 // COMP is in 18 decimal
				)
				: 0;
		if (tokenBalance <= totalProductivity) {
			return (0, 0, tokenBalance, balanceInUSD, compValueInUSD);
		}
		uint256 tokenGains = tokenBalance - totalProductivity;
		uint256 tokenGainsInUSD =
			_returnTokenGainsInUSD
				? getTokenValueInUSD(tokenUsdOracle, tokenGains,token.decimals()) +
					compValueInUSD
				: 0;
		uint256 iTokenGains;
		if (caseType) {
			iTokenGains =
				((tokenGains / 10**decimalDifference) * 10**mantissa) /
				er; // based on https://compound.finance/docs#protocol-math
		} else {
			iTokenGains =
				((tokenGains * 10**decimalDifference) * 10**mantissa) /
				er; // based on https://compound.finance/docs#protocol-math
		}

		return (
			iTokenGains,
			tokenGains,
			tokenBalance,
			balanceInUSD,
			tokenGainsInUSD
		);
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
		ERC20 comp = ERC20(nameService.getAddress("COMP"));
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
		public
		view
		override
		returns (uint256)
	{
		cERC20 cToken = cERC20(address(iToken));
		uint256 er = cToken.exchangeRateStored();
		(uint256 decimalDifference, bool caseType) = tokenDecimalPrecision();
		uint256 mantissa = 18 + tokenDecimal() - iTokenDecimal();
		uint256 tokenWorth =
			caseType == true
				? (_amount * (10**decimalDifference) * er) / 10**mantissa
				: ((_amount / (10**decimalDifference)) * er) / 10**mantissa; // calculation based on https://compound.finance/docs#protocol-math
		return tokenWorth;
	}

	/**
	 * @dev Set Gas cost to interest collection for this contract
	 * @param _amount Gas cost to collect interest
	 * @param _rewardTokenCollectCost gas cost to collect reward tokens
	 */
	function setcollectInterestGasCostParams(uint32 _amount, uint32 _rewardTokenCollectCost) external {
		_onlyAvatar();
		collectInterestGasCost = _amount;
		compCollectGasCost = _rewardTokenCollectCost;
	}
	
	function _approveTokens() internal override {
		address uniswapRouter = nameService.getAddress("UNISWAP_ROUTER");
		ERC20(nameService.getAddress("COMP")).approve(
			uniswapRouter,
			type(uint256).max
		);
		token.approve(uniswapRouter, type(uint256).max);
		token.approve(address(iToken), type(uint256).max); // approve the transfers to defi protocol as much as possible in order to save gas
	}
}
