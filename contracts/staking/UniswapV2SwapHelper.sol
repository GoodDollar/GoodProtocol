// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../Interfaces.sol";

contract UniswapV2SwapHelper is ISwapHelper {
	function getRouter(address _optionalRouter)
		internal
		pure
		returns (address)
	{
		return
			_optionalRouter == address(0x0)
				? address(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D)
				: _optionalRouter;
	}

	/**
	 *@dev Helper to calculate percentage out of token liquidity in pool
	 *@param _inToken address of token we are swapping
	 *@param _outToken address of swap result token
	 *@param _fee unused
	 *@param _maxPercentage percentage points (out of 10000) out of input token pool liquidity that we feel safe to swap, not to change price too much
	 *@param _optionalRouter use a different uniswap router if != address(0)
	 */
	function maxProtectedTokenAmount(
		address _inToken,
		address _outToken,
		uint24 _fee,
		uint24 _maxPercentage,
		address _optionalRouter
	) public view override returns (uint256) {
		_fee;
		address wETH = Uniswap(getRouter(_optionalRouter)).WETH();
		_inToken = _inToken == address(0x0) ? wETH : _inToken;
		_outToken = _outToken == address(0x0) ? wETH : _outToken;
		UniswapPair pair = UniswapPair(
			UniswapFactory(Uniswap(getRouter(_optionalRouter)).factory())
			.getPair(_inToken, _outToken)
		);
		(uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
		uint112 reserve = reserve0;
		if (_inToken == pair.token1()) {
			reserve = reserve1;
		}

		return (reserve * _maxPercentage) / 10000;
	}

	/**
	@dev Helper to swap tokens in the Uniswap
	*@param _path the buy path
    *@param _fees unused
	*@param _tokenAmount token amount to swap
	*@param _minTokenReturn minimum token amount to get in swap transaction
	*@param _receiver receiver of tokens after swap transaction
    *@param _maxLiquidityPercentage percentage points (out of 10000) out of input token pool liquidity that we feel safe to swap, not to change price too much
    * so it is more resilient against sandwich attacks
    *@param _optionalRouter use a different uniswap router if != address(0)
    *
	 */
	function swap(
		address[] memory _path,
		uint24[] calldata _fees,
		uint256 _tokenAmount,
		uint256 _minTokenReturn,
		address _receiver,
		uint24 _maxLiquidityPercentage,
		address _optionalRouter
	) external override returns (uint256 swapResult) {
		_fees;
		Uniswap uniswapContract = Uniswap(getRouter(_optionalRouter));
		uint256[] memory result;
		uint256 maxSafeTokenAmount = maxProtectedTokenAmount(
			_path[0],
			_path[1],
			0,
			_maxLiquidityPercentage,
			_optionalRouter
		);
		maxSafeTokenAmount = maxSafeTokenAmount < _tokenAmount
			? maxSafeTokenAmount
			: _tokenAmount;

		if (_path[0] != address(0x0)) {
			ERC20(_path[0]).approve(
				address(uniswapContract),
				maxSafeTokenAmount
			);
		}

		if (_path[0] == address(0x0)) {
			_path[0] = uniswapContract.WETH();
			result = uniswapContract.swapExactETHForTokens{
				value: maxSafeTokenAmount
			}(_minTokenReturn, _path, _receiver, block.timestamp);
		} else if (_path[_path.length - 1] == address(0x0)) {
			_path[_path.length - 1] = uniswapContract.WETH();
			result = uniswapContract.swapExactTokensForETH(
				maxSafeTokenAmount,
				_minTokenReturn,
				_path,
				_receiver,
				block.timestamp
			);
		} else {
			result = uniswapContract.swapExactTokensForTokens(
				maxSafeTokenAmount,
				_minTokenReturn,
				_path,
				_receiver,
				block.timestamp
			);
		}
		return result[result.length - 1];
	}
}
