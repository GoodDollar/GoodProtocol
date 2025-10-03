// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

interface IUniswapV3Pool {
	function initialize(uint160 sqrtPriceX96) external;

	function token0() external view returns (address);

	function token1() external view returns (address);

	function slot0()
		external
		view
		returns (
			uint160 sqrtPriceX96,
			int24 tick,
			uint16 observationIndex,
			uint16 observationCardinality,
			uint16 observationCardinalityNext,
			uint8 feeProtocol,
			bool unlocked
		);
}

interface INonfungiblePositionManager {
	struct MintParams {
		address token0;
		address token1;
		uint24 fee;
		int24 tickLower;
		int24 tickUpper;
		uint256 amount0Desired;
		uint256 amount1Desired;
		uint256 amount0Min;
		uint256 amount1Min;
		address recipient;
		uint256 deadline;
	}

	function mint(
		MintParams calldata params
	)
		external
		payable
		returns (
			uint256 tokenId,
			uint128 liquidity,
			uint256 amount0,
			uint256 amount1
		);
}
