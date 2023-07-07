// SPDX-License-Identifier: MIT

pragma solidity >=0.8;
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../Interfaces.sol";

interface ISwapRouter {
	struct ExactInputSingleParams {
		address tokenIn;
		address tokenOut;
		uint24 fee;
		address recipient;
		uint256 amountIn;
		uint256 amountOutMinimum;
		uint160 sqrtPriceLimitX96;
	}

	/// @notice Swaps `amountIn` of one token for as much as possible of another token
	/// @dev Setting `amountIn` to 0 will cause the contract to look up its own balance,
	/// and swap the entire amount, enabling contracts to send tokens before calling this function.
	/// @param params The parameters necessary for the swap, encoded as `ExactInputSingleParams` in calldata
	/// @return amountOut The amount of the received token
	function exactInputSingle(
		ExactInputSingleParams calldata params
	) external payable returns (uint256 amountOut);

	struct ExactInputParams {
		bytes path;
		address recipient;
		uint256 amountIn;
		uint256 amountOutMinimum;
	}

	/// @notice Swaps `amountIn` of one token for as much as possible of another along the specified path
	/// @dev Setting `amountIn` to 0 will cause the contract to look up its own balance,
	/// and swap the entire amount, enabling contracts to send tokens before calling this function.
	/// @param params The parameters necessary for the multi-hop swap, encoded as `ExactInputParams` in calldata
	/// @return amountOut The amount of the received token
	function exactInput(
		ExactInputParams calldata params
	) external payable returns (uint256 amountOut);

	struct ExactOutputSingleParams {
		address tokenIn;
		address tokenOut;
		uint24 fee;
		address recipient;
		uint256 amountOut;
		uint256 amountInMaximum;
		uint160 sqrtPriceLimitX96;
	}

	/// @notice Swaps as little as possible of one token for `amountOut` of another token
	/// that may remain in the router after the swap.
	/// @param params The parameters necessary for the swap, encoded as `ExactOutputSingleParams` in calldata
	/// @return amountIn The amount of the input token
	function exactOutputSingle(
		ExactOutputSingleParams calldata params
	) external payable returns (uint256 amountIn);

	struct ExactOutputParams {
		bytes path;
		address recipient;
		uint256 amountOut;
		uint256 amountInMaximum;
	}

	/// @notice Swaps as little as possible of one token for `amountOut` of another along the specified path (reversed)
	/// that may remain in the router after the swap.
	/// @param params The parameters necessary for the multi-hop swap, encoded as `ExactOutputParams` in calldata
	/// @return amountIn The amount of the input token
	function exactOutput(
		ExactOutputParams calldata params
	) external payable returns (uint256 amountIn);
}

contract BuyGDClone is Initializable {
	error NOT_ALLOWED(address);
	error REFUND_FAILED(uint256);

	ISwapRouter public immutable router;
	address public constant celo = 0x471EcE3750Da237f93B8E339c536989b8978a438;
	address public immutable cusd;
	address public immutable gd;

	address public owner;
	address public executer;

	receive() external payable {}

	constructor(ISwapRouter _router, address _cusd, address _gd) {
		router = _router;
		cusd = _cusd;
		gd = _gd;
	}

	function initialize(address _owner, address _executer) external initializer {
		owner = _owner;
		executer = _executer;
	}

	function swap(uint256 _minAmount) external {
		uint256 gasCosts = msg.sender == owner ? 0 : (block.basefee + 1e9) * 400000;
		if (msg.sender != owner && msg.sender != executer)
			revert NOT_ALLOWED(msg.sender);
		uint256 balance = address(this).balance;
		ERC20(celo).approve(address(router), balance);
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(celo, uint24(3000), cusd, uint24(10000), gd),
			recipient: owner,
			amountIn: balance - gasCosts,
			amountOutMinimum: _minAmount
		});
		router.exactInput(params);
		if (msg.sender != owner) {
			(bool sent, ) = msg.sender.call{ value: gasCosts }("");
			if (!sent) revert REFUND_FAILED(gasCosts);
		}
	}

	function swapCusd(uint256 _minAmount) external {
		uint256 gasCosts = msg.sender == executer ? 1e17 : 0;
		if (msg.sender != owner && msg.sender != executer)
			revert NOT_ALLOWED(msg.sender);
		uint balance = ERC20(cusd).balanceOf(address(this));
		ERC20(cusd).approve(address(router), balance);
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(cusd, uint24(10000), gd),
			recipient: owner,
			amountIn: balance - gasCosts,
			amountOutMinimum: _minAmount
		});
		router.exactInput(params);
		if (msg.sender == executer) {
			ERC20(cusd).transfer(msg.sender, gasCosts);
		}
	}

	function recover(address token) external {
		if (token == address(0)) {
			(bool sent, ) = payable(owner).call{ value: address(this).balance }("");
			if (!sent) revert REFUND_FAILED(address(this).balance);
		} else ERC20(token).transfer(owner, ERC20(token).balanceOf(address(this)));
	}
}

contract BuyGDCloneFactory {
	address immutable impl;

	constructor(ISwapRouter _router, address _cusd, address _gd) {
		impl = address(new BuyGDClone(_router, _cusd, _gd));
	}

	function create(address owner, address executer) external returns (address) {
		bytes32 salt = keccak256(abi.encode(owner, executer));
		address clone = ClonesUpgradeable.cloneDeterministic(impl, salt);
		BuyGDClone(payable(clone)).initialize(owner, executer);
		return clone;
	}

	function predict(
		address owner,
		address executer
	) external view returns (address) {
		bytes32 salt = keccak256(abi.encode(owner, executer));

		return
			ClonesUpgradeable.predictDeterministicAddress(impl, salt, address(this));
	}
}
