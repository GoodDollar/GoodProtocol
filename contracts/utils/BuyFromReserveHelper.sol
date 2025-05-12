// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../MentoInterfaces.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract BuyFromReserveHelper is AccessControl, ReentrancyGuard {
	using SafeERC20 for IERC20;

	bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
	bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

	address public safe;
	address public exchangeProvider;
	bytes32 public exchangeId;
	IERC20 public tokenIn;
	IERC20 public tokenOut;
	IBroker public broker;

	event SafeUpdated(address indexed newSafe);
	event SettingsUpdated(
		address indexed exchangeProvider,
		bytes32 indexed exchangeId
	);
	event GDBought(address indexed buyer, uint256 amountIn, uint256 amountOut);

	constructor(
		address _safe,
		address _tokenIn,
		address _tokenOut,
		address _broker,
		address _exchangeProvider,
		bytes32 _exchangeId
	) {
		require(_safe != address(0), "Safe address cannot be zero");
		require(_tokenIn != address(0), "TokenIn address cannot be zero");
		require(_tokenOut != address(0), "TokenOut address cannot be zero");
		require(_broker != address(0), "Broker address cannot be zero");
		require(_exchangeProvider != address(0), "ExchangeProvider cannot be zero");
		require(_exchangeId != bytes32(0), "ExchangeId cannot be zero");

		safe = _safe;
		tokenIn = IERC20(_tokenIn);
		tokenOut = IERC20(_tokenOut);
		broker = IBroker(_broker);
		exchangeProvider = _exchangeProvider;
		exchangeId = _exchangeId;

		_setupRole(DEFAULT_ADMIN_ROLE, _safe);
		_setupRole(EXECUTOR_ROLE, msg.sender);
	}

	function updateSafe(address _newSafe) external {
		require(msg.sender == safe, "Only safe can update");
		require(_newSafe != address(0), "New safe address cannot be zero");

		// Update admin role
		_revokeRole(DEFAULT_ADMIN_ROLE, safe);
		_setupRole(DEFAULT_ADMIN_ROLE, _newSafe);

		safe = _newSafe;
		emit SafeUpdated(_newSafe);
	}

	function updateSettings(
		address _exchangeProvider,
		bytes32 _exchangeId,
		address _tokenIn,
		address _tokenOut,
		address _broker
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		require(_exchangeProvider != address(0), "ExchangeProvider cannot be zero");
		require(_exchangeId != bytes32(0), "ExchangeId cannot be zero");
		require(_tokenIn != address(0), "TokenIn address cannot be zero");
		require(_tokenOut != address(0), "TokenOut address cannot be zero");
		require(_broker != address(0), "Broker address cannot be zero");

		exchangeProvider = _exchangeProvider;
		exchangeId = _exchangeId;
		tokenIn = IERC20(_tokenIn);
		tokenOut = IERC20(_tokenOut);
		broker = IBroker(_broker);

		emit SettingsUpdated(_exchangeProvider, _exchangeId);
	}

	function buyGdFromBroker(
		uint256 amountInNominal,
		uint256 minReturnNominal
	) external onlyRole(EXECUTOR_ROLE) nonReentrant {
		require(amountInNominal > 0, "Amount must be greater than zero");
		require(minReturnNominal > 0, "Minimum return must be greater than zero");

		uint256 amountIn = amountInNominal * 1e18;
		uint256 minReturn = minReturnNominal * 1e18;

		// assume minimum price for 0.00005 for G$ for safety check
		require((amountIn * 1e18) / 5e13 >= minReturn, "minReturn seems too low");

		// Transfer tokenIn from the safe to this contract
		tokenIn.safeTransferFrom(safe, address(this), amountIn);

		// Reset any existing approval
		tokenIn.safeApprove(address(broker), 0);
		// Approve the broker to spend tokenIn
		tokenIn.safeApprove(address(broker), amountIn);

		// Call the broker to buy tokenOut (G$)
		uint256 amountOut = broker.swapIn(
			exchangeProvider,
			exchangeId,
			address(tokenIn),
			address(tokenOut),
			amountIn,
			minReturn
		);

		// Verify minimum return
		require(amountOut >= minReturn, "Insufficient return amount");

		// Transfer bought tokens to safe
		tokenOut.safeTransfer(safe, amountOut);

		emit GDBought(msg.sender, amountIn, amountOut);
	}
}
