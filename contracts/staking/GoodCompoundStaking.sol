// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "./SimpleStaking.sol";
import "../Interfaces.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Token
 * or withdraw their stake in Token
 * the contracts buy cToken and can transfer the daily interest to the  DAO
 */
contract GoodCompoundStaking is SimpleStaking {
	/**
	 * @param _token Token to swap DEFI token
	 * @param _iToken DEFI token address
	 * @param _ns Address of the NameService
	 * @param _tokenName Name of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Symbol of the staking token which will be provided to staker for their staking share
	 * @param _tokenSymbol Determines blocks to pass for 1x Multiplier
	 * @param _tokenUsdOracle address of the TOKEN/USD oracle
	 * @param _collectInterestGasCost Gas cost for the collect interest of this staking contract
	 */
	constructor(
		address _token,
		address _iToken,
		uint256 _blockInterval,
		NameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		uint32 _collectInterestGasCost
	)
		SimpleStaking(
			_token,
			_iToken,
			_blockInterval,
			_ns,
			_tokenName,
			_tokenSymbol,
			_maxRewardThreshold,
			_collectInterestGasCost
		)
	{
		tokenUsdOracle = _tokenUsdOracle;
	}

	// Address of the TOKEN/USD oracle from chainlink
	address public tokenUsdOracle;

	/**
	 * @dev stake some Token
	 * @param _amount of Token to stake
	 */
	function mintInterestToken(uint256 _amount) internal override {
		cERC20 cToken = cERC20(address(iToken));
		uint256 res = cToken.mint(_amount);

		require(res == 0, "Minting cToken failed, funds returned");
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
	 * @dev Function to redeem cToken for DAI
	 * @dev _amount of token in iToken
	 * @return return address of the DAI and amount of the DAI
	 */
	function redeemUnderlyingToDAI(uint256 _amount)
		internal
		override
		returns (address, uint256)
	{
		if (address(iToken) == nameService.getAddress("CDAI")) {
			return (address(iToken), _amount); // If iToken is cDAI then just return cDAI
		}
		cERC20 cToken = cERC20(address(iToken));
		require(cToken.redeem(_amount) == 0, "Failed to redeem cToken");
		uint256 redeemedAmount = token.balanceOf(address(this));
		address daiAddress = nameService.getAddress("DAI");
		address[] memory path = new address[](2);
		path[0] = address(token);
		path[1] = daiAddress;
		Uniswap uniswapContract =
			Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
		token.approve(address(uniswapContract), redeemedAmount);
		uint256[] memory swap =
			uniswapContract.swapExactTokensForTokens(
				redeemedAmount,
				0,
				path,
				address(this),
				block.timestamp
			);

		uint256 dai = swap[1];
		require(dai > 0, "token selling failed");
		return (daiAddress, swap[1]);
	}

	/**
	 * @dev returns token to iToken Exchange rate.
	 */
	function exchangeRate() internal view override returns (uint256) {
		cERC20 cToken = cERC20(address(iToken));
		return cToken.exchangeRateStored();
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
	 * @dev Function to get TOKEN/USD oracle address
	 * @return address of the TOKEN/USD oracle
	 */
	function getTokenUsdOracle() internal view override returns (address) {
		return tokenUsdOracle;
	}

	function getGasCostForInterestTransfer()
		external
		view
		override
		returns (uint32)
	{
		return collectInterestGasCost;
	}
}
