// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ERC777Helper } from "@superfluid-finance/ethereum-contracts/contracts/libs/ERC777Helper.sol";
import { FixedSizeData } from "@superfluid-finance/ethereum-contracts/contracts/libs/FixedSizeData.sol";

// import { UUPSProxiable } from "./UUPSProxiable.sol";
import { ERC777Helper } from "@superfluid-finance/ethereum-contracts/contracts/libs/ERC777Helper.sol";
import { IGoodDollarCustom } from "./ISuperGoodDollar.sol";

import { SuperToken } from "./SuperToken.sol";
import "../ERC677.sol";
import "../FeesFormula.sol";
import "../../Interfaces.sol";
import "./ERC20Permit.sol";
import "./SuperToken.sol";

// import "hardhat/console.sol";

// IMPORTANT: The order of base contracts with storage MUST REMAIN AS IS after the initial deployment.
// Changing order can result in storage corruption when upgrading.
contract SuperGoodDollar is
	SuperToken, // includes 32 storage slots padding for SuperToken
	AccessControlEnumerableUpgradeable, // with storage
	PausableUpgradeable,
	ERC20Permit,
	ERC677, // without storage
	IGoodDollarCustom // without storage
{
	// IMPORTANT! Never change the type (storage size) or order of state variables.
	// If a variable isn't needed anymore, leave it as padding (renaming is ok).
	address public feeRecipient;
	IFeesFormula public formula;
	IIdentity public identity;
	uint256 public cap;
	bool public disableHostOperations;
	// Append additional state variables here!

	// ============== constants and immutables ==============

	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
	bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

	event TransferFee(
		address from,
		address to,
		uint256 amount,
		uint256 fee,
		bool senderPays
	);

	// ========================================================================================
	// ============== Functionality to be executed on the proxy via delegateCall ==============
	// ========================================================================================

	/// initializes state specific to the GoodDollar token
	/// When upgrading to a new logic contract,
	function initialize(
		string calldata n,
		string calldata s,
		uint256 _cap,
		IFeesFormula _formula,
		IIdentity _identity,
		address _feeRecipient,
		address _owner
	) public initializer {
		initialize(IERC20(address(0)), 18, n, s);
		__AccessControl_init_unchained();
		__Pausable_init_unchained();
		__ERC20Permit_init(n);
		_setupRole(DEFAULT_ADMIN_ROLE, _owner);
		_setupRole(MINTER_ROLE, _owner);
		_setupRole(PAUSER_ROLE, _owner);
		feeRecipient = _feeRecipient;
		identity = _identity;
		formula = _formula;
		cap = _cap;
	}

	// ============ SuperFluid ============

	constructor(ISuperfluid _host) SuperToken(_host) {}

	/// @dev override superfluid initializer with onlyInitializing modifier, so our main initializer must be called
	function initialize(
		IERC20 underlyingToken,
		uint8 underlyingDecimals,
		string calldata n,
		string calldata s
	)
		public
		override
		onlyInitializing // OpenZeppelin Initializable
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

	function proxiableUUID() public pure override returns (bytes32) {
		return
			keccak256(
				"org.superfluid-finance.contracts.SuperGoodDollar.implementation"
			);
	}

	function updateCode(address newAddress) external override onlyOwner {
		UUPSProxiable._updateCodeAddress(newAddress);
	}

	/// override Superfluid agreement function in order to make it pausable
	/// that is, no new streams can be started when the contract is paused
	function createAgreement(bytes32 id, bytes32[] calldata data)
		public
		override(ISuperfluidToken, SuperfluidToken)
	{
		require(!paused(), "Pausable: createAgreement while paused");
		// otherwise the wrapper of SuperToken.createAgreement does the actual job
		super.createAgreement(id, data);
	}

	/// failsafe in case we don't want to trust superfluid host for batch operations
	function allowHostOperations()
		internal
		view
		virtual
		override
		returns (bool hostEnabled)
	{
		return !disableHostOperations;
	}

	function enableHostOperations(bool enabled) external onlyOwner {
		disableHostOperations = !enabled;
	}

	// ============ IGoodDollarCustom ============

	modifier onlyOwner() {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "not owner");
		_;
	}

	modifier onlyPauser() {
		require(hasRole(PAUSER_ROLE, msg.sender), "not pauser");
		_;
	}

	modifier onlyMinter() {
		require(hasRole(MINTER_ROLE, msg.sender), "not minter");
		_;
	}

	function owner() external view override returns (address) {
		return getRoleMember(DEFAULT_ADMIN_ROLE, 0);
	}

	function setFormula(IFeesFormula _formula) external override onlyOwner {
		formula = _formula;
	}

	function setIdentity(IIdentityV2 _identity) external override onlyOwner {
		identity = _identity;
	}

	function transferOwnership(address _owner) public override onlyOwner {
		grantRole(DEFAULT_ADMIN_ROLE, _owner);
		renounceRole(DEFAULT_ADMIN_ROLE, _msgSender());
	}

	function isMinter(address _minter) external view override returns (bool) {
		return hasRole(MINTER_ROLE, _minter);
	}

	function addMinter(address _minter) external override {
		grantRole(MINTER_ROLE, _minter); // enforces permissions
	}

	function renounceMinter() external override {
		renounceRole(MINTER_ROLE, _msgSender()); // enforces permissions
	}

	function isPauser(address _pauser) external view override returns (bool) {
		return hasRole(PAUSER_ROLE, _pauser);
	}

	function addPauser(address _pauser) external override {
		grantRole(PAUSER_ROLE, _pauser); // enforces permissions
	}

	function pause() public override onlyPauser {
		_pause();
	}

	function unpause() public override onlyPauser {
		_unpause();
	}

	/**
	 * @dev Processes transfer fees and calls ERC677Token transferAndCall function
	 * @param to address to transfer to
	 * @param amount the amount to transfer
	 * @param data The data to pass to transferAndCall
	 * @return a bool indicating if transfer function succeeded
	 */
	function transferAndCall(
		address to,
		uint256 amount,
		bytes calldata data
	) external override returns (bool) {
		//duplicated code from _transferAndCall so we can get the amount after fees correctly for transferAndCall event + callback
		require(!paused(), "Pausable: token transfer while paused");
		uint256 bruttoValue = _processFees(msg.sender, to, amount);
		// handing over to the wrapper of SuperToken.transferFrom skipping this _transferFrom which also collects fees
		bool res = super._transferFrom(msg.sender, msg.sender, to, bruttoValue);
		emit ERC677.Transfer(msg.sender, to, bruttoValue, data);
		if (isContract(to)) {
			require(
				contractFallback(to, bruttoValue, data),
				"Contract fallback failed"
			);
		}
		return res;
	}

	function transfer(address to, uint256 amount)
		public
		virtual
		override(ERC677, SuperToken)
		returns (bool)
	{
		return _transferFrom(msg.sender, msg.sender, to, amount);
	}

	/// make sure supertoken erc20 methods include fees and pausable
	function _transferFrom(
		address spender,
		address holder,
		address recipient,
		uint256 amount
	) internal virtual override returns (bool) {
		require(!paused(), "Pausable: token transfer while paused");
		uint256 bruttoValue = _processFees(holder, recipient, amount);
		// handing over to the wrapper of SuperToken.transferFrom
		super._transferFrom(spender, holder, recipient, bruttoValue);
		return true;
	}

	/// make sure supertoken erc777 methods include fees and pausable
	function _send(
		address operator,
		address from,
		address to,
		uint256 amount,
		bytes memory userData,
		bytes memory operatorData,
		bool requireReceptionAck
	) internal virtual override {
		require(!paused(), "Pausable: token transfer while paused");
		uint256 bruttoValue = _processFees(from, to, amount);
		// handing over to the wrapper of SuperToken.transferFrom
		super._send(
			operator,
			from,
			to,
			bruttoValue,
			userData,
			operatorData,
			requireReceptionAck
		);
	}

	/// make sure supertoken erc777 methods include pausable
	function _burn(
		address operator,
		address from,
		uint256 amount,
		bytes memory userData,
		bytes memory operatorData
	) internal virtual override {
		require(!paused(), "Pausable: token transfer while paused");
		// handing over to the wrapper of SuperToken.transferFrom
		super._burn(operator, from, amount, userData, operatorData);
	}

	/**
	 * @dev Minting function
	 * @param to the address that will receive the minted tokens
	 * @param amount the amount of tokens to mint
	 */
	function mint(address to, uint256 amount)
		public
		override(IGoodDollarCustom)
		onlyMinter
		returns (bool)
	{
		require(!paused(), "Pausable: token transfer while paused");

		if (cap > 0) {
			require(
				totalSupply() + amount <= cap,
				"Cannot increase supply beyond cap"
			);
		}
		_mint(
			msg.sender,
			to,
			amount,
			false, /* requireReceptionAck */
			new bytes(0),
			new bytes(0)
		);

		return true;
	}

	function burnFrom(address account, uint256 amount) public {
		uint256 currentAllowance = allowance(account, _msgSender());
		require(currentAllowance >= amount, "ERC20: burn amount exceeds allowance");
		unchecked {
			_approve(account, _msgSender(), currentAllowance - amount);
		}
		_burn(msg.sender, account, amount, new bytes(0), new bytes(0));
	}

	function burn(uint256 amount) external override {
		_burn(msg.sender, msg.sender, amount, new bytes(0), new bytes(0));
	}

	/**
	 * @dev Gets the current transaction fees
	 * @return fee senderPays  that represents the current transaction fees and bool true if sender pays the fee or receiver
	 */
	function getFees(uint256 amount)
		public
		view
		returns (uint256 fee, bool senderPays)
	{
		return formula.getTxFees(amount, address(0), address(0));
	}

	/**
	 * @dev Gets the current transaction fees
	 * @return fee senderPays  that represents the current transaction fees and bool true if sender pays the fee or receiver
	 */
	function getFees(
		uint256 amount,
		address sender,
		address recipient
	) public view returns (uint256 fee, bool senderPays) {
		return formula.getTxFees(amount, sender, recipient);
	}

	/**
	 * @dev Sets the address that receives the transactional fees.
	 * can only be called by owner
	 * @param _feeRecipient The new address to receive transactional fees
	 */
	function setFeeRecipient(address _feeRecipient) public onlyOwner {
		feeRecipient = _feeRecipient;
	}

	// internal functions

	/**
	 * @dev Sends transactional fees to feeRecipient address from given address
	 * @param account The account that sends the fees
	 * @param amount The amount to subtract fees from
	 * @return an uint256 that represents the given amount minus the transactional fees
	 */
	function _processFees(
		address account,
		address recipient,
		uint256 amount
	) internal returns (uint256) {
		(uint256 txFees, bool senderPays) = getFees(amount, account, recipient);
		if (txFees > 0 && !identity.isDAOContract(msg.sender)) {
			require(
				senderPays == false || amount + txFees <= balanceOf(account),
				"Not enough balance to pay TX fee"
			);
			super._transferFrom(account, account, feeRecipient, txFees);
			emit TransferFee(account, recipient, amount, txFees, senderPays);
			return senderPays ? amount : amount - txFees;
		}
		return amount;
	}
}
