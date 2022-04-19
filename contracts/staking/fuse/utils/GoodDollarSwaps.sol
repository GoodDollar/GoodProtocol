// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../PegSwap.sol";
import "../../../Interfaces.sol";

contract GoodDollarSwaps {
	Uniswap public uniswapV2Router;
	IGoodDollar public goodDollar;
	UniswapFactory public uniswapFactory;
	UniswapPair public uniswapGoodDollarFusePair;

	uint256 public constant RATIO_BASE = 10000;

	uint256 public maxSlippageRatio; //actually its max price impact ratio

	address public USDC;
	address public fUSD;

	PegSwap public pegSwap;

	mapping(bytes32 => uint256) internal buffersForPendingFuse;

	function _safeBuyGD(uint256 _value, bytes32 _bufferNameHash)
		internal
		returns (uint256[] memory result)
	{
			uint256 pendingFuseToBeSwapped = buffersForPendingFuse[_bufferNameHash];
			uint256 valueAndPendingFuseAmount = _value + pendingFuseToBeSwapped;
			result = _buyGD(valueAndPendingFuseAmount);
			buffersForPendingFuse[_bufferNameHash] = valueAndPendingFuseAmount - result[0];
			result[2] = buffersForPendingFuse[_bufferNameHash];
	}

	/**
	 * @dev internal method to buy goodDollar from fuseswap
	 * @param _value fuse to be sold
	 * @return result uniswapV2Router coversion results uint256[2]
	 */
	function _buyGD(uint256 _value) internal returns (uint256[] memory result) {
		//buy from uniwasp
		require(_value > 0, "buy value should be > 0");
		(uint256 maxFuse, uint256 fuseGDOut) = calcMaxFuseWithPriceImpact(_value);
		(uint256 maxFuseUSDC, uint256 usdcGDOut) = calcMaxFuseUSDCWithPriceImpact(
			_value
		);
		address[] memory path;
		uint256[] memory swapResult;
		if (maxFuse >= maxFuseUSDC) {
			path = new address[](2);
			path[0] = uniswapV2Router.WETH();
			path[1] = address(goodDollar);
			swapResult = uniswapV2Router.swapExactETHForTokens{ value: maxFuse }(
				(fuseGDOut * 95) / 100,
				path,
				address(this),
				block.timestamp
			);
		} else {
			(uint256 usdcAmount, uint256 usedFuse) = _buyUSDC(maxFuseUSDC);
			path = new address[](2);
			path[0] = USDC;
			path[1] = address(goodDollar);
			swapResult = uniswapV2Router.swapExactTokensForTokens(
				usdcAmount,
				(usdcGDOut * 95) / 100,
				path,
				address(this),
				block.timestamp
			);
			//buyGD should return how much fuse was used in [0] and how much G$ we got in [1]
			swapResult[0] = usedFuse;
		}
		result = new uint256[](3);
		result[0] = swapResult[0];
		result[1] = swapResult[1];
	}

	/**
	 * @dev internal method to buy USDC via fuse->fusd
	 * @param _fuseIn fuse to be sold
	 * @return usdcAmount and usedFuse how much usdc we got and how much fuse was used
	 */

	function _buyUSDC(uint256 _fuseIn)
		internal
		returns (uint256 usdcAmount, uint256 usedFuse)
	{
		//buy from uniwasp
		require(_fuseIn > 0, "buy value should be > 0");
		UniswapPair uniswapFUSEfUSDPair = UniswapPair(
			uniswapFactory.getPair(uniswapV2Router.WETH(), fUSD)
		); //fusd is pegged 1:1 to usdc
		(uint256 r_fuse, uint256 r_fusd, ) = uniswapFUSEfUSDPair.getReserves();

		(uint256 maxFuse, uint256 tokenOut) = calcMaxTokenWithPriceImpact(
			r_fuse,
			r_fusd,
			_fuseIn
		); //expect r_token to be in 18 decimals

		address[] memory path = new address[](2);
		path[1] = fUSD;
		path[0] = uniswapV2Router.WETH();
		uint256[] memory result = uniswapV2Router.swapExactETHForTokens{
			value: maxFuse
		}((tokenOut * 95) / 100, path, address(this), block.timestamp);

		pegSwap.swap(result[1], fUSD, USDC);
		usedFuse = result[0];
		usdcAmount = result[1] / 1e12; //convert fusd from 1e18 to usdc 1e6
	}

	function calcMaxFuseWithPriceImpact(uint256 _value)
		public
		view
		returns (uint256 fuseAmount, uint256 tokenOut)
	{
		(uint256 r_fuse, uint256 r_gd, ) = uniswapGoodDollarFusePair.getReserves();

		return calcMaxTokenWithPriceImpact(r_fuse, r_gd, _value);
	}

	function calcMaxFuseUSDCWithPriceImpact(uint256 _value)
		public
		view
		returns (uint256 maxFuse, uint256 gdOut)
	{
		UniswapPair uniswapFUSEfUSDPair = UniswapPair(
			uniswapFactory.getPair(uniswapV2Router.WETH(), fUSD)
		); //fusd is pegged 1:1 to usdc
		UniswapPair uniswapGDUSDCPair = UniswapPair(
			uniswapFactory.getPair(address(goodDollar), USDC)
		);
		(uint256 rg_gd, uint256 rg_usdc, ) = uniswapGDUSDCPair.getReserves();
		(uint256 r_fuse, uint256 r_fusd, ) = uniswapFUSEfUSDPair.getReserves();
		uint256 fusdPriceInFuse = (r_fuse * 1e18) / r_fusd; //fusd is 1e18 so to keep in original 1e18 precision we first multiply by 1e18
		// console.log(
		// 	"rgd: %s rusdc:%s usdcPriceInFuse: %s",
		// 	rg_gd,
		// 	rg_usdc,
		// 	fusdPriceInFuse
		// );
		// console.log("rfuse: %s rusdc:%s", r_fuse, r_fusd);

		//how many fusd we can get for fuse
		uint256 fuseValueInfUSD = (_value * 1e18) / fusdPriceInFuse; //value and usdPriceInFuse are in 1e18, we mul by 1e18 to keep 18 decimals precision
		// console.log("fuse fusd value: %s", fuseValueInfUSD);

		(uint256 maxUSDC, uint256 tokenOut) = calcMaxTokenWithPriceImpact(
			rg_usdc * 1e12,
			rg_gd,
			fuseValueInfUSD
		); //expect r_token to be in 18 decimals
		// console.log("max USDC: %s", maxUSDC);
		gdOut = tokenOut;
		maxFuse = (maxUSDC * fusdPriceInFuse) / 1e18; //both are in 1e18 precision, div by 1e18 to keep precision
	}

	/**
	 * uniswapV2Router amountOut helper
	 */
	function _getAmountOut(
		uint256 _amountIn,
		uint256 _reserveIn,
		uint256 _reserveOut
	) internal pure returns (uint256 amountOut) {
		uint256 amountInWithFee = _amountIn * 997;
		uint256 numerator = amountInWithFee * _reserveOut;
		uint256 denominator = _reserveIn * 1000 + amountInWithFee;
		amountOut = numerator / denominator;
	}

	/**
	 * @dev use binary search to find quantity that will result with price impact < maxPriceImpactRatio
	 */
	function calcMaxTokenWithPriceImpact(
		uint256 r_token,
		uint256 r_gd,
		uint256 _value
	) public view returns (uint256 maxToken, uint256 tokenOut) {
		maxToken = (r_token * maxSlippageRatio) / RATIO_BASE;
		maxToken = maxToken < _value ? maxToken : _value;
		tokenOut = _getAmountOut(maxToken, r_token, r_gd);
	}
}
