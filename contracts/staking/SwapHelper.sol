// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

contract SwapHelper is DAOUpgradeableContract {
	uint256 private _status;

	function initialize(INameService _ns) public virtual initializer {
		setDAO(_ns);
	}

	function encodePath(address[] _tokenAddresses, _fees)
		internal
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

	function maxProtectedTokenAmount(address[] memory _path)
		external
		view
		returns (uint256)
	{
		ISwapRouter uniswap = ISwapRouter(
			nameService.getAddress("UNISWAP_V3_ROUTER")
		);
		address tokenA = _path[0] == address(0x0) ? uniswap.WETH() : _path[0];

		UniswapPair(UniswapFactory(uniswap.factory()).getPair(tokenA, _path[1]))
			.getReserves();
	}

	/**
	@dev Helper to swap tokens in the Uniswap
	*@param _path the buy path
	*@param _tokenAmount token amount to sell or buy
	*@param _minDAIAmount minimum DAI amount to get in swap transaction if transaction is buy
	*@param _minTokenReturn minimum token amount to get in swap transaction if transaction is sell
	*@param _receiver receiver of tokens after swap transaction
	 */
	function swap(
		address[] memory _path,
		uint256 _tokenAmount,
		uint256 _minTokenReturn,
		address _receiver
	) external returns (uint256[] memory) {
		Uniswap uniswapContract = Uniswap(
			nameService.getAddress("UNISWAP_ROUTER")
		);
		address wETH = uniswapContract.WETH();
		uint256[] memory swap;
		if (_path[0] == address(0x0)) {
			_path[0] = wETH;
			swap = uniswapContract.swapExactETHForTokens{ value: _tokenAmount }(
				_minTokenReturn,
				_path,
				_receiver,
				block.timestamp
			);
			return swap;
		} else if (_path[_path.length - 1] == address(0x0)) {
			_path[_path.length - 1] = wETH;
			swap = uniswapContract.swapExactTokensForETH(
				_tokenAmount,
				_minTokenReturn,
				_path,
				_receiver,
				block.timestamp
			);
			return swap;
		} else {
			ERC20(_path[0]).approve(address(uniswapContract), _tokenAmount);
			swap = uniswapContract.swapExactTokensForTokens(
				_tokenAmount,
				_minTokenReturn,
				_path,
				_receiver,
				block.timestamp
			);
			return swap;
		}
	}
}
