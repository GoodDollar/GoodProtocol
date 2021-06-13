// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../SimpleStaking.sol";
import "../../Interfaces.sol";
import "../../utils/DataTypes.sol";
import "hardhat/console.sol";
/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Token
 * or withdraw their stake in Token
 * the contracts buy cToken and can transfer the daily interest to the  DAO
 */
contract GoodAaveStaking is SimpleStaking {
	// Address of the TOKEN/USD oracle from chainlink
	address public tokenUsdOracle;

	//LendingPool of aave
	ILendingPool public lendingPool;

	//Address of the AaveIncentivesController
	IAaveIncentivesController incentiveController;

	//address of the AAVE/USD oracle
	address public aaveUSDOracle;
	// Gas cost to collect interest from this staking contract
	uint32 public collectInterestGasCost = 250000;

	/**
	 * @param _token Token to swap DEFI token
	 * @param _lendingPool LendingPool address
	 * @param _ns Address of the NameService
	 * @param _tokenName Name of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Symbol of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Determines blocks to pass for 1x Multiplier
	 * @param _tokenUsdOracle address of the TOKEN/USD oracle
	 * @param _incentiveController Aave incentive controller which provides AAVE rewards
	 * @param _aaveUSDOracle address of the AAVE/USD oracle
	 */
	function init(
		address _token,
		address _lendingPool,
		INameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		IAaveIncentivesController _incentiveController,
		address _aaveUSDOracle
	) public {
		lendingPool = ILendingPool(_lendingPool);
		DataTypes.ReserveData memory reserve =
			lendingPool.getReserveData(_token);
		initialize(
			_token,
			reserve.aTokenAddress,
			_ns,
			_tokenName,
			_tokenSymbol,
			_maxRewardThreshold
		);
		//above  initialize going  to revert on second call, so this is safe
		tokenUsdOracle = _tokenUsdOracle;
		incentiveController = _incentiveController;
		aaveUSDOracle = _aaveUSDOracle;

		_approveTokens();
	}

	/**
	 * @dev stake some Token
	 * @param _amount of Token to stake
	 */
	function mintInterestToken(uint256 _amount) internal override {
		lendingPool.deposit(address(token), _amount, address(this), 0);
	}

	/**
	 * @dev redeem Token from aave
	 * @param _amount of token to redeem in Token
	 */
	function redeem(uint256 _amount) internal override {
		lendingPool.withdraw(address(token), _amount, address(this));
	}

	/**
	 * @dev Function to redeem aToken for DAI, so reserve knows how to handle it. (reserve can handle dai or cdai)
	 * @dev _amount of token in iToken
	 * @return return address of the DAI and amount of the DAI
	 */
	function redeemUnderlyingToDAI(uint256 _amount)
		internal
		override
		returns (address, uint256)
	{
		lendingPool.withdraw(address(token), _amount, address(this));
		uint256 redeemedAmount = token.balanceOf(address(this));
		console.log("redeemedAmount %s",redeemedAmount);
		address[] memory tokenAddress = new address[](1);
		tokenAddress[0] = address(token);
		address daiAddress = nameService.getAddress("DAI");
		uint256 aaveBalance = incentiveController.getRewardsBalance(
						tokenAddress,
						address(this));
		Uniswap uniswapContract =
			Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
		address reserveAddress = nameService.getAddress("RESERVE");
		address[] memory path = new address[](2);
		path[1] = daiAddress;
		uint256[] memory swap;
		uint256 daiFromAave;
		if(aaveBalance > 0){
			incentiveController.claimRewards(tokenAddress, aaveBalance, address(this));
			path[0] = nameService.getAddress("AAVE");
			swap =
			uniswapContract.swapExactTokensForTokens(
				aaveBalance,
				0,
				path,
				reserveAddress,
				block.timestamp
			);
			daiFromAave = swap[1];
		}
		uint256 daiFromToken;	
		if(redeemedAmount > 0){
			path[0] = address(token);		
		swap =
			uniswapContract.swapExactTokensForTokens(
				redeemedAmount,
				0,
				path,
				reserveAddress,
				block.timestamp
			);
		daiFromToken = swap[1];
		}
		
		

		return (daiAddress, daiFromAave + daiFromToken);
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
		ERC20 aToken = ERC20(address(iToken));
		return uint256(aToken.decimals());
	}

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
		ERC20 aToken = ERC20(address(iToken));
		uint256 tokenBalance = aToken.balanceOf(address(this));
		uint256 balanceInUSD =
			_returnTokenBalanceInUSD
				? getTokenValueInUSD(tokenUsdOracle, tokenBalance)
				: 0;
		address[] memory tokenAddress = new address[](1);
		tokenAddress[0] = address(token);
		uint256 aaveValueInUSD =
			_returnTokenGainsInUSD
				? getAaveValueInUSD(
					incentiveController.getRewardsBalance(
						tokenAddress,
						address(this)
					)
				)
				: 0;
		if (tokenBalance <= totalProductivity) {
			return (0, 0, tokenBalance, balanceInUSD, aaveValueInUSD);
		}
		uint256 tokenGains = tokenBalance - totalProductivity;

		uint256 tokenGainsInUSD =
			_returnTokenGainsInUSD
				? getTokenValueInUSD(tokenUsdOracle, tokenGains) +
					aaveValueInUSD
				: 0;
		return (
			tokenGains, // since token gains = atoken gains
			tokenGains,
			tokenBalance,
			balanceInUSD,
			tokenGainsInUSD
		);
	}

	function getGasCostForInterestTransfer()
		external
		view
		override
		returns (uint32)
	{
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
		return _amount; // since aToken is peg to Token 1:1 return exact amount
	}

	function getAaveValueInUSD(uint256 _amount) public view returns (uint256) {
		AggregatorV3Interface tokenPriceOracle =
			AggregatorV3Interface(aaveUSDOracle);
		int256 aavePriceinUSD = tokenPriceOracle.latestAnswer();
		return (uint256(aavePriceinUSD) * _amount) / 1e18;
	}

	function _approveTokens() internal override {
		address uniswapRouter = nameService.getAddress("UNISWAP_ROUTER");
		ERC20(nameService.getAddress("AAVE")).approve(
			uniswapRouter,
			type(uint256).max
		);
		token.approve(uniswapRouter, type(uint256).max);
		token.approve(address(lendingPool), type(uint256).max); // approve the transfers to defi protocol as much as possible in order to save gas
	}
}
