pragma solidity >=0.8.0;

import "../staking/UniswapV3SwapHelper.sol";

contract SwapMock {
	UniswapV3SwapHelper swapHelper;

	event Result(bytes result);

	constructor(UniswapV3SwapHelper _swapHelper) {
		setHelper(_swapHelper);
	}

	function setHelper(UniswapV3SwapHelper _swapHelper) public {
		swapHelper = _swapHelper;
	}

	function encodePath(address[] memory _tokenAddresses, uint24[] memory _fees)
		public
		returns (bytes memory encodedPath)
	{
		(bool success, bytes memory result) = address(swapHelper).delegatecall(
			abi.encodeWithSignature(
				"encodePath(address[],uint24[])",
				_tokenAddresses,
				_fees
			)
		);
		(encodedPath) = abi.decode(result, (bytes));
		emit Result(result);
	}
}
