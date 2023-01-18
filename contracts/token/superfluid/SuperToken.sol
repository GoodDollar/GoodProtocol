// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import { UUPSProxiable } from "./UUPSProxiable.sol";

import { ISuperfluid, ISuperfluidGovernance, ISuperToken, ISuperAgreement, IERC20, IERC777, TokenInfo } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { ISuperfluidToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluidToken.sol";

import { ERC777Helper } from "@superfluid-finance/ethereum-contracts/contracts/libs/ERC777Helper.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IERC777Recipient } from "@openzeppelin/contracts/token/ERC777/IERC777Recipient.sol";
import { IERC777Sender } from "@openzeppelin/contracts/token/ERC777/IERC777Sender.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";

import { SuperfluidToken } from "./SuperfluidToken.sol";

/**
 * @title Superfluid's super token implementation
 *
 * @author Superfluid
 * @dev Modified for SuperGoodDollar
 * 1. made virtual - transfer,_transferFrom,_send,_burn, proxiableuuid, initialize, updateCode
 * 2. removed upgrade/downgrade internal methods, all external/public using _upgrade/_downgrade will revert
 * 3. use modified UUPSProxy with openzep upgradeable Initializable instead of openzep regular Initializable used by superfluid
 * 4. fixed erc777 burn and operator burn to work for puresupertokens
 * 5. removed unused "self" functions
 */
contract SuperToken is UUPSProxiable, SuperfluidToken, ISuperToken {
	using SafeMath for uint256;
	using SafeCast for uint256;
	using Address for address;
	using ERC777Helper for ERC777Helper.Operators;
	using SafeERC20 for IERC20;

	uint8 private constant _STANDARD_DECIMALS = 18;

	/* WARNING: NEVER RE-ORDER VARIABLES! Including the base contracts.
       Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */

	/// @dev The underlying ERC20 token
	IERC20 internal _underlyingToken;

	/// @dev Decimals of the underlying token
	uint8 internal _underlyingDecimals;

	/// @dev TokenInfo Name property
	string internal _name;

	/// @dev TokenInfo Symbol property
	string internal _symbol;

	/// @dev ERC20 Allowances Storage
	mapping(address => mapping(address => uint256)) internal _allowances;

	/// @dev ERC777 operators support data
	ERC777Helper.Operators internal _operators;

	// NOTE: for future compatibility, these are reserved solidity slots
	// The sub-class of SuperToken solidity slot will start after _reserve22

	// NOTE: Whenever modifying the storage layout here it is important to update the validateStorageLayout
	// function in its respective mock contract to ensure that it doesn't break anything or lead to unexpected
	// behaviors/layout when upgrading

	uint256 internal _reserve22;
	uint256 private _reserve23;
	uint256 private _reserve24;
	uint256 private _reserve25;
	uint256 private _reserve26;
	uint256 private _reserve27;
	uint256 private _reserve28;
	uint256 private _reserve29;
	uint256 private _reserve30;
	uint256 internal _reserve31;

	constructor(ISuperfluid host)
		SuperfluidToken(host)
	// solhint-disable-next-line no-empty-blocks
	{

	}

	function initialize(
		IERC20 underlyingToken,
		uint8 underlyingDecimals,
		string calldata n,
		string calldata s
	)
		external
		virtual
		override
		initializer // OpenZeppelin Initializable
	{
		_underlyingToken = underlyingToken;
		_underlyingDecimals = underlyingDecimals;

		_name = n;
		_symbol = s;

		// register interfaces
		ERC777Helper.register(address(this));

		// help tools like explorers detect the token contract
		emit Transfer(address(0), address(0), 0);
	}

	function proxiableUUID() public pure virtual override returns (bytes32) {
		return
			keccak256("org.superfluid-finance.contracts.SuperToken.implementation");
	}

	function updateCode(address newAddress) external virtual override {
		if (msg.sender != address(_host)) revert SUPER_TOKEN_ONLY_HOST();
		UUPSProxiable._updateCodeAddress(newAddress);
	}

	/**************************************************************************
	 * ERC20 Token Info
	 *************************************************************************/

	function name() external view override returns (string memory) {
		return _name;
	}

	function symbol() external view override returns (string memory) {
		return _symbol;
	}

	function decimals() external pure override returns (uint8) {
		return _STANDARD_DECIMALS;
	}

	/**************************************************************************
	 * (private) Token Logics
	 *************************************************************************/

	/**
	 * @notice in the original openzeppelin implementation, transfer() and transferFrom()
	 * did invoke the send and receive hooks, as required by ERC777.
	 * This hooks were removed from super tokens for ERC20 transfers in order to protect
	 * interfacing contracts which don't expect invocations of ERC20 transfers to potentially reenter.
	 * Interactions relying on ERC777 hooks need to use the ERC777 interface.
	 * For more context, see https://github.com/superfluid-finance/protocol-monorepo/wiki/About-ERC-777
	 */
	function _transferFrom(
		address spender,
		address holder,
		address recipient,
		uint256 amount
	) internal virtual returns (bool) {
		if (holder == address(0)) {
			revert SUPER_TOKEN_TRANSFER_FROM_ZERO_ADDRESS();
		}
		if (recipient == address(0)) {
			revert SUPER_TOKEN_TRANSFER_TO_ZERO_ADDRESS();
		}
		address operator = msg.sender;

		_move(operator, holder, recipient, amount, "", "");

		if (spender != holder) {
			_approve(
				holder,
				spender,
				_allowances[holder][spender].sub(
					amount,
					"SuperToken: transfer amount exceeds allowance"
				)
			);
		}

		return true;
	}

	/**
	 * @dev Send tokens
	 * @param operator address operator address
	 * @param from address token holder address
	 * @param to address recipient address
	 * @param amount uint256 amount of tokens to transfer
	 * @param userData bytes extra information provided by the token holder (if any)
	 * @param operatorData bytes extra information provided by the operator (if any)
	 * @param requireReceptionAck if true, contract recipients are required to implement ERC777TokensRecipient
	 */
	function _send(
		address operator,
		address from,
		address to,
		uint256 amount,
		bytes memory userData,
		bytes memory operatorData,
		bool requireReceptionAck
	) internal virtual {
		if (from == address(0)) {
			revert SUPER_TOKEN_TRANSFER_FROM_ZERO_ADDRESS();
		}
		if (to == address(0)) {
			revert SUPER_TOKEN_TRANSFER_TO_ZERO_ADDRESS();
		}

		_callTokensToSend(operator, from, to, amount, userData, operatorData);

		_move(operator, from, to, amount, userData, operatorData);

		_callTokensReceived(
			operator,
			from,
			to,
			amount,
			userData,
			operatorData,
			requireReceptionAck
		);
	}

	function _move(
		address operator,
		address from,
		address to,
		uint256 amount,
		bytes memory userData,
		bytes memory operatorData
	) private {
		SuperfluidToken._move(from, to, amount.toInt256());

		emit Sent(operator, from, to, amount, userData, operatorData);
		emit Transfer(from, to, amount);
	}

	/**
	 * @dev Creates `amount` tokens and assigns them to `account`, increasing
	 * the total supply.
	 *
	 * If a send hook is registered for `account`, the corresponding function
	 * will be called with `operator`, `data` and `operatorData`.
	 *
	 * See {IERC777Sender} and {IERC777Recipient}.
	 *
	 * Emits {Minted} and {IERC20-Transfer} events.
	 *
	 * Requirements
	 *
	 * - `account` cannot be the zero address.
	 * - if `account` is a contract, it must implement the {IERC777Recipient}
	 * interface.
	 */
	function _mint(
		address operator,
		address account,
		uint256 amount,
		bool requireReceptionAck,
		bytes memory userData,
		bytes memory operatorData
	) internal {
		if (account == address(0)) {
			revert SUPER_TOKEN_MINT_TO_ZERO_ADDRESS();
		}

		SuperfluidToken._mint(account, amount);

		_callTokensReceived(
			operator,
			address(0),
			account,
			amount,
			userData,
			operatorData,
			requireReceptionAck
		);

		emit Minted(operator, account, amount, userData, operatorData);
		emit Transfer(address(0), account, amount);
	}

	/**
	 * @dev Burn tokens
	 * @param from address token holder address
	 * @param amount uint256 amount of tokens to burn
	 * @param userData bytes extra information provided by the token holder
	 * @param operatorData bytes extra information provided by the operator (if any)
	 */
	function _burn(
		address operator,
		address from,
		uint256 amount,
		bytes memory userData,
		bytes memory operatorData
	) internal virtual {
		if (from == address(0)) {
			revert SUPER_TOKEN_BURN_FROM_ZERO_ADDRESS();
		}

		_callTokensToSend(
			operator,
			from,
			address(0),
			amount,
			userData,
			operatorData
		);

		SuperfluidToken._burn(from, amount);

		emit Burned(operator, from, amount, userData, operatorData);
		emit Transfer(from, address(0), amount);
	}

	/**
	 * @notice Sets `amount` as the allowance of `spender` over the `account`s tokens.
	 *
	 * This is internal function is equivalent to `approve`, and can be used to
	 * e.g. set automatic allowances for certain subsystems, etc.
	 *
	 * Emits an {Approval} event.
	 *
	 * Requirements:
	 *
	 * - `account` cannot be the zero address.
	 * - `spender` cannot be the zero address.
	 */
	function _approve(
		address account,
		address spender,
		uint256 amount
	) internal {
		if (account == address(0)) {
			revert SUPER_TOKEN_APPROVE_FROM_ZERO_ADDRESS();
		}
		if (spender == address(0)) {
			revert SUPER_TOKEN_APPROVE_TO_ZERO_ADDRESS();
		}

		_allowances[account][spender] = amount;
		emit Approval(account, spender, amount);
	}

	/**
	 * @dev Call from.tokensToSend() if the interface is registered
	 * @param operator address operator requesting the transfer
	 * @param from address token holder address
	 * @param to address recipient address
	 * @param amount uint256 amount of tokens to transfer
	 * @param userData bytes extra information provided by the token holder (if any)
	 * @param operatorData bytes extra information provided by the operator (if any)
	 */
	function _callTokensToSend(
		address operator,
		address from,
		address to,
		uint256 amount,
		bytes memory userData,
		bytes memory operatorData
	) private {
		address implementer = ERC777Helper
			._ERC1820_REGISTRY
			.getInterfaceImplementer(
				from,
				ERC777Helper._TOKENS_SENDER_INTERFACE_HASH
			);
		if (implementer != address(0)) {
			IERC777Sender(implementer).tokensToSend(
				operator,
				from,
				to,
				amount,
				userData,
				operatorData
			);
		}
	}

	/**
	 * @dev Call to.tokensReceived() if the interface is registered. Reverts if the recipient is a contract but
	 * tokensReceived() was not registered for the recipient
	 * @param operator address operator requesting the transfer
	 * @param from address token holder address
	 * @param to address recipient address
	 * @param amount uint256 amount of tokens to transfer
	 * @param userData bytes extra information provided by the token holder (if any)
	 * @param operatorData bytes extra information provided by the operator (if any)
	 * @param requireReceptionAck if true, contract recipients are required to implement ERC777TokensRecipient
	 */
	function _callTokensReceived(
		address operator,
		address from,
		address to,
		uint256 amount,
		bytes memory userData,
		bytes memory operatorData,
		bool requireReceptionAck
	) private {
		address implementer = ERC777Helper
			._ERC1820_REGISTRY
			.getInterfaceImplementer(
				to,
				ERC777Helper._TOKENS_RECIPIENT_INTERFACE_HASH
			);
		if (implementer != address(0)) {
			IERC777Recipient(implementer).tokensReceived(
				operator,
				from,
				to,
				amount,
				userData,
				operatorData
			);
		} else if (requireReceptionAck) {
			if (to.isContract()) revert SUPER_TOKEN_NOT_ERC777_TOKENS_RECIPIENT();
		}
	}

	/**************************************************************************
	 * ERC20 Implementations
	 *************************************************************************/

	function totalSupply() public view override returns (uint256) {
		return _totalSupply;
	}

	function balanceOf(address account)
		public
		view
		override
		returns (uint256 balance)
	{
		// solhint-disable-next-line not-rely-on-time
		(int256 availableBalance, , , ) = super.realtimeBalanceOfNow(account);
		return availableBalance < 0 ? 0 : uint256(availableBalance);
	}

	function transfer(address recipient, uint256 amount)
		public
		virtual
		override
		returns (bool)
	{
		return _transferFrom(msg.sender, msg.sender, recipient, amount);
	}

	function allowance(address account, address spender)
		public
		view
		override
		returns (uint256)
	{
		return _allowances[account][spender];
	}

	function approve(address spender, uint256 amount)
		public
		override
		returns (bool)
	{
		_approve(msg.sender, spender, amount);
		return true;
	}

	function transferFrom(
		address holder,
		address recipient,
		uint256 amount
	) public override returns (bool) {
		return _transferFrom(msg.sender, holder, recipient, amount);
	}

	function increaseAllowance(address spender, uint256 addedValue)
		public
		override
		returns (bool)
	{
		_approve(
			msg.sender,
			spender,
			_allowances[msg.sender][spender] + addedValue
		);
		return true;
	}

	function decreaseAllowance(address spender, uint256 subtractedValue)
		public
		override
		returns (bool)
	{
		_approve(
			msg.sender,
			spender,
			_allowances[msg.sender][spender].sub(
				subtractedValue,
				"SuperToken: decreased allowance below zero"
			)
		);
		return true;
	}

	/**************************************************************************
	 * ERC-777 functions
	 *************************************************************************/

	function granularity() external pure override returns (uint256) {
		return 1;
	}

	function send(
		address recipient,
		uint256 amount,
		bytes calldata data
	) external override {
		_send(msg.sender, msg.sender, recipient, amount, data, "", true);
	}

	function burn(uint256 amount, bytes calldata data) external virtual override {
		_burn(msg.sender, msg.sender, amount, data, new bytes(0));
	}

	function isOperatorFor(address operator, address tokenHolder)
		external
		view
		override
		returns (bool)
	{
		return _operators.isOperatorFor(operator, tokenHolder);
	}

	function authorizeOperator(address operator) external override {
		address holder = msg.sender;
		_operators.authorizeOperator(holder, operator);
		emit AuthorizedOperator(operator, holder);
	}

	function revokeOperator(address operator) external override {
		address holder = msg.sender;
		_operators.revokeOperator(holder, operator);
		emit RevokedOperator(operator, holder);
	}

	function defaultOperators()
		external
		view
		override
		returns (address[] memory)
	{
		return ERC777Helper.defaultOperators(_operators);
	}

	function operatorSend(
		address sender,
		address recipient,
		uint256 amount,
		bytes calldata data,
		bytes calldata operatorData
	) external override {
		address operator = msg.sender;
		if (!_operators.isOperatorFor(operator, sender))
			revert SUPER_TOKEN_CALLER_IS_NOT_OPERATOR_FOR_HOLDER();
		_send(operator, sender, recipient, amount, data, operatorData, true);
	}

	function operatorBurn(
		address account,
		uint256 amount,
		bytes calldata data,
		bytes calldata operatorData
	) external override {
		address operator = msg.sender;
		if (!_operators.isOperatorFor(operator, account))
			revert SUPER_TOKEN_CALLER_IS_NOT_OPERATOR_FOR_HOLDER();
		_burn(operator, account, amount, data, operatorData);
	}

	function _setupDefaultOperators(address[] memory operators) internal {
		_operators.setupDefaultOperators(operators);
	}

	/**************************************************************************
	 * SuperToken custom token functions
	 *************************************************************************/

	/// unused - place holder
	function selfMint(
		address account,
		uint256 amount,
		bytes memory userData
	) external override onlySelf {
		revert();
	}

	/// unused - place holder
	function selfBurn(
		address account,
		uint256 amount,
		bytes memory userData
	) external override onlySelf {
		revert();
	}

	/// still used by erc20permit
	function selfApproveFor(
		address account,
		address spender,
		uint256 amount
	) external override onlySelf {
		_approve(account, spender, amount);
	}

	/// unused - place holder
	function selfTransferFrom(
		address holder,
		address spender,
		address recipient,
		uint256 amount
	) external override onlySelf {
		revert();
	}

	/**************************************************************************
	 * SuperToken extra functions
	 *************************************************************************/

	function transferAll(address recipient) external override {
		_transferFrom(msg.sender, msg.sender, recipient, balanceOf(msg.sender));
	}

	/**************************************************************************
	 * ERC20 wrapping
	 *************************************************************************/

	/// @dev ISuperfluidGovernance.getUnderlyingToken implementation
	function getUnderlyingToken() external view override returns (address) {
		return address(_underlyingToken);
	}

	/// @dev ISuperToken.upgrade implementation
	function upgrade(uint256 amount) external override {
		//keep only for interface override not required for G$
		revert();
	}

	/// @dev ISuperToken.upgradeTo implementation
	function upgradeTo(
		address to,
		uint256 amount,
		bytes calldata data
	) external override {
		//keep only for interface override not required for G$
		revert();
	}

	/// @dev ISuperToken.downgrade implementation
	function downgrade(uint256 amount) external override {
		//keep only for interface override not required for G$
		revert();
	}

	/**************************************************************************
	 * Superfluid Batch Operations
	 *************************************************************************/

	function allowHostOperations()
		internal
		view
		virtual
		override
		returns (bool hostEnabled)
	{
		return true;
	}

	function operationApprove(
		address account,
		address spender,
		uint256 amount
	) external override onlyHost {
		_approve(account, spender, amount);
	}

	function operationTransferFrom(
		address account,
		address spender,
		address recipient,
		uint256 amount
	) external override onlyHost {
		_transferFrom(account, spender, recipient, amount);
	}

	function operationUpgrade(address account, uint256 amount)
		external
		override
		onlyHost
	{
		revert();
	}

	function operationDowngrade(address account, uint256 amount)
		external
		override
		onlyHost
	{
		revert();
	}

	/**************************************************************************
	 * Modifiers
	 *************************************************************************/

	modifier onlySelf() {
		if (msg.sender != address(this)) revert SUPER_TOKEN_ONLY_SELF();
		_;
	}
}
