// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IPeripheryImmutableState.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IPeripheryPayments.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../Interfaces.sol";

contract UniswapV3SwapHelper {
	function encodePath(address[] memory _tokenAddresses, uint24[] memory _fees)
		public
		pure
		returns (bytes memory)
	{
		bytes memory encodedPath;

		for (uint256 i; i < _tokenAddresses.length; i++) {
			if (i != _tokenAddresses.length - 1) {
				encodedPath = abi.encodePacked(
					encodedPath,
					_tokenAddresses[i],
					_fees[i]
				);
			} else {
				encodedPath = abi.encodePacked(encodedPath, _tokenAddresses[i]);
			}
		}
		return encodedPath;
	}

	function getRouter(address _optionalRouter)
		internal
		pure
		returns (address)
	{
		return
			_optionalRouter == address(0x0)
				? address(0xE592427A0AEce92De3Edee1F18E0157C05861564)
				: _optionalRouter;
	}

	function maxProtectedTokenAmount(
		address _tokenA,
		address _tokenB,
		uint24 _fee,
		address _optionalRouter
	) external view returns (uint256) {
		IPeripheryImmutableState uniswap = IPeripheryImmutableState(
			getRouter(_optionalRouter)
		);
		_tokenA = _tokenA == address(0x0) ? uniswap.WETH9() : _tokenA;

		IUniswapV3Pool(
			IUniswapV3Factory(uniswap.factory()).getPool(_tokenA, _tokenB, _fee)
		);
		return 1;
	}

	/**
	@dev Helper to swap tokens in the Uniswap
	*@param _path the buy path
	*@param _tokenAmount token amount to sell or buy
	*@param _minTokenReturn minimum token amount to get in swap transaction if transaction is sell
	*@param _receiver receiver of tokens after swap transaction
	 */
	function swap(
		address[] memory _path,
		uint24[] calldata _fees,
		uint256 _tokenAmount,
		uint256 _minTokenReturn,
		address _receiver,
		address _optionalRouter
	) external returns (uint256 swapResult) {
		ISwapRouter uniswap = ISwapRouter(getRouter(_optionalRouter));
		address wETH = IPeripheryImmutableState(address(uniswap)).WETH9();
		ISwapRouter.ExactInputParams memory params;
		params.recipient = _receiver;
		params.amountIn = _tokenAmount;
		params.amountOutMinimum = _minTokenReturn;

		if (_path[0] == address(0x0)) {
			_path[0] = wETH;
			params.path = encodePath(_path, _fees);
			swapResult = uniswap.exactInput{ value: _tokenAmount }(params);
		} else if (_path[_path.length - 1] == address(0x0)) {
			_path[_path.length - 1] = wETH;
			params.path = encodePath(_path, _fees);
			//recipient is uniswap router, then we call unwrapWETH9 to send ether to receiver
			params.recipient = address(uniswap);
			swapResult = uniswap.exactInput{ value: _tokenAmount }(params);
			IPeripheryPayments(address(uniswap)).unwrapWETH9(
				swapResult,
				_receiver
			);
		} else {
			ERC20(_path[0]).approve(address(uniswap), _tokenAmount);
			params.path = encodePath(_path, _fees);
			swapResult = uniswap.exactInput{ value: _tokenAmount }(params);
		}
	}
}
