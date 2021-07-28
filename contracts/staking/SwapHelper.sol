// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IPeripheryImmutableState.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

contract SwapHelper {
	function encodePath(address[] memory _tokenAddresses, uint24[] memory _fees)
		public
		view
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

	function maxProtectedTokenAmount(
		address uniswapRouter,
		address tokenA,
		address tokenB,
		uint24 fee
	) external view returns (uint256) {
		IPeripheryImmutableState uniswap = IPeripheryImmutableState(
			uniswapRouter
		);
		address tokenA = tokenA == address(0x0) ? uniswap.WETH9() : tokenA;

		IUniswapV3Pool(
			IUniswapV3Factory(uniswap.factory()).getPool(tokenA, tokenB, fee)
		);
		return 1;
	}

	/**
	@dev Helper to swap tokens in the Uniswap
	*@param _path the buy path
	*@param _tokenAmount token amount to sell or buy
	*@param _minDAIAmount minimum DAI amount to get in swap transaction if transaction is buy
	*@param _minTokenReturn minimum token amount to get in swap transaction if transaction is sell
	*@param _receiver receiver of tokens after swap transaction
	 */
	// function swap(
	// 	address[] memory _path,
	// 	uint256 _tokenAmount,
	// 	uint256 _minTokenReturn,
	// 	address _receiver
	// ) external returns (uint256[] memory) {
	// 	Uniswap uniswapContract = Uniswap(
	// 		nameService.getAddress("UNISWAP_ROUTER")
	// 	);
	// 	address wETH = uniswapContract.WETH();
	// 	uint256[] memory swap;
	// 	if (_path[0] == address(0x0)) {
	// 		_path[0] = wETH;
	// 		swap = uniswapContract.swapExactETHForTokens{ value: _tokenAmount }(
	// 			_minTokenReturn,
	// 			_path,
	// 			_receiver,
	// 			block.timestamp
	// 		);
	// 		return swap;
	// 	} else if (_path[_path.length - 1] == address(0x0)) {
	// 		_path[_path.length - 1] = wETH;
	// 		swap = uniswapContract.swapExactTokensForETH(
	// 			_tokenAmount,
	// 			_minTokenReturn,
	// 			_path,
	// 			_receiver,
	// 			block.timestamp
	// 		);
	// 		return swap;
	// 	} else {
	// 		ERC20(_path[0]).approve(address(uniswapContract), _tokenAmount);
	// 		swap = uniswapContract.swapExactTokensForTokens(
	// 			_tokenAmount,
	// 			_minTokenReturn,
	// 			_path,
	// 			_receiver,
	// 			block.timestamp
	// 		);
	// 		return swap;
	// 	}
	// }
}
