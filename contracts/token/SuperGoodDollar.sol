// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import "./ERC677.sol";
import "./FeesFormula.sol";
import "../Interfaces.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import { ISuperfluid, ISuperToken, ISuperTokenFactory } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import { ISuperToken, CustomSuperTokenBase } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/CustomSuperTokenBase.sol";
import { UUPSProxy } from "@superfluid-finance/ethereum-contracts/contracts/upgradability/UUPSProxy.sol";

import "./AuxProxiable.sol";

/**
 * This contract wraps SuperToken functions into internal functions.
 * This makes it more convenient to invoke them from the context of a delegate call
 * and to override them in another logic contract (call the wrapper instead of super.fn()).
 * The invoker of this functions is responsible for the required permission checks.
 * Occupies storage slots through the base contract
 */
abstract contract SuperTokenBase is CustomSuperTokenBase {
	function _totalSupply() internal view returns (uint256 t) {
		return ISuperToken(address(this)).totalSupply();
	}

	function _mint(
		address account,
		uint256 amount,
		bytes memory userData
	) internal {
		ISuperToken(address(this)).selfMint(account, amount, userData);
	}

	function _burn(
		address from,
		uint256 amount,
		bytes memory userData
	) internal {
		ISuperToken(address(this)).selfBurn(from, amount, userData);
	}

	function _approve(
		address account,
		address spender,
		uint256 amount
	) internal {
		ISuperToken(address(this)).selfApproveFor(account, spender, amount);
	}

	function _transferFrom(
		address holder,
		address spender,
		address recipient,
		uint256 amount
	) internal {
		ISuperToken(address(this)).selfTransferFrom(
			holder,
			spender,
			recipient,
			amount
		);
	}

	function _balanceOf(address account) internal view returns (uint256) {
		return ISuperToken(address(this)).balanceOf(account);
	}

	function allowance(address owner, address spender)
		internal
		view
		returns (uint256)
	{
		return ISuperToken(address(this)).allowance(owner, spender);
	}

	function _createAgreement(bytes32 id, bytes32[] calldata data) internal {
		ISuperToken(address(this)).createAgreement(id, data);
	}
}

/**
 * @title Proxy for a GoodDollar V2.
 * delegates to both SuperToken logic and GoodDollar logic.
 * NOTE: This contract adds no storage slots. If that changes,
 * corresponding padding needs to be added to `GoodDollarCustom` right after `SuperTokenBase`
 */
contract GoodDollarProxy is
	CustomSuperTokenBase, // adds 32 storage slots
	UUPSProxy
{
	/// @dev initializes the proxy with 2 logic contracts to delegate to
	/// NOTE DO NOT directly call initializeProxy() !
	function initialize(
		ISuperfluid sfHost,
		GoodDollarCustom auxLogic,
		string memory name,
		string memory symbol,
		uint256 cap,
		IFeesFormula formula,
		IIdentity identity,
		address feeRecipient,
		address owner
	) external {
		ISuperTokenFactory factory = sfHost.getSuperTokenFactory();
		// this invokes UUPSProxy.initializeProxy(), connecting the primary logic contract
		factory.initializeCustomSuperToken(address(this));
		// this connects the secondary (aux) logic contract
		AuxUtils.setImplementation(address(auxLogic));

		// this invokes the Initializer of UUPSProxiable of the primary logic contract
		ISuperToken(address(this)).initialize(IERC20(address(0)), 2, name, symbol);
		// this invokes the Initializer of AuxProxiable of the secondary (aux) logic contract
		GoodDollarCustom(address(this)).initializeAux(
			cap,
			formula,
			identity,
			feeRecipient,
			owner
		);

		// "consume" the initializer, so random strangers can't
		auxLogic.setAsInitialized();
	}

	// ============ internal ============

	// Dispatcher for all other calls
	function _fallback() internal virtual override {
		_beforeFallback();

		// check if the call should go to the GoodDollar logic or SuperToken logic
		address auxLogic = AuxUtils.implementation();
		if (AuxProxiable(auxLogic).implementsFn(msg.sig)) {
			_delegate(AuxUtils.implementation());
		} else {
			_delegate(_implementation());
		}
	}
}

// GoodDollar specific functions
interface IGoodDollarCustom {
	// view functions
	function feeRecipient() external view returns (address);

	function getFees(uint256 value)
		external
		view
		returns (uint256 fee, bool senderPays);

	function getFees(
		uint256 value,
		address sender,
		address recipient
	) external view returns (uint256 fee, bool senderPays);

	function formula() external view returns (IFeesFormula);

	function identity() external view returns (IIdentity);

	function cap() external view returns (uint256);

	function isMinter(address _minter) external view returns (bool);

	function isPauser(address _pauser) external view returns (bool);

	function owner() external view returns (address);

	// state changing functions
	function setFeeRecipient(address _feeRecipient) external;

	function setFormula(IFeesFormula _formula) external;

	function setIdentity(IIdentityV2 _identity) external;

	function transferOwnership(address _owner) external;

	function transferAndCall(
		address to,
		uint256 value,
		bytes calldata data
	) external returns (bool);

	function mint(address to, uint256 amount) external returns (bool);

	function burn(uint256 amount) external;

	function burnFrom(address account, uint256 amount) external;

	function addMinter(address _minter) external;

	function renounceMinter() external;

	function addPauser(address _pauser) external;

	function pause() external;

	function unpause() external;
}

interface ISuperGoodDollar is IGoodDollarCustom, ISuperToken {}

// IMPORTANT: The order of base contracts with storage MUST REMAIN AS IS after the initial deployment.
// Changing order can result in storage corruption when upgrading.
contract GoodDollarCustom is
	SuperTokenBase, // includes 32 storage slots padding for SuperToken
	AccessControlEnumerableUpgradeable, // with storage
	PausableUpgradeable, // with storage
	AuxProxiable, // without storage
	ERC677, // without storage
	IGoodDollarCustom // without storage
{
	// IMPORTANT! Never change the type (storage size) or order of state variables.
	// If a variable isn't needed anymore, leave it as padding (renaming is ok).
	address public feeRecipient;
	IFeesFormula public formula;
	IIdentity public identity;
	uint256 public cap;
	// Append additional state variables here!

	// ============== constants and immutables ==============

	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
	bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

	// ==============================================================================
	// ============== Functionality to be executed on the logic itself ==============
	// ==============================================================================

	// allows to set the logic contract itself as initialized
	function setAsInitialized() public initializer {}

	// ============== AuxProxiable ==============

	// Allows the proxy to check if this contract wants to handle a given call.
	// All functions supposed to be used as delegateCall on the proxy contract
	// need to be included here, otherwise they're unreachable.
	// Also note that any function selector included here may shadow a function
	// with the same signature in the `SuperToken` contract.
	// This is ok if intended (e.g. in order to change behaviour of that function),
	// but shouldn't happen by accident.
	function implementsFn(bytes4 selector) external pure override returns (bool) {
		return
			selector == this.initializeAux.selector ||
			// IGoodDollarCustom
			selector == this.feeRecipient.selector ||
			selector == this.formula.selector ||
			selector == this.identity.selector ||
			selector == this.cap.selector ||
			selector == this.setFormula.selector ||
			selector == this.setIdentity.selector ||
			selector == this.transferOwnership.selector ||
			selector == this.mint.selector ||
			selector == bytes4(keccak256("burn(uint256)")) ||
			selector == this.burnFrom.selector ||
			selector == this.transferAndCall.selector ||
			selector == this.setFeeRecipient.selector ||
			selector == this.owner.selector ||
			// overloaded function getFees needs special treatment
			selector == bytes4(keccak256("getFees(uint256)")) ||
			selector == bytes4(keccak256("getFees(uint256,address,address)")) ||
			// AuxProxiable
			selector == this.proxiableAuxUUID.selector ||
			selector == this.updateAuxCode.selector ||
			selector == this.getAuxCodeAddress.selector ||
			// AccessControlUpgradeable
			selector == this.hasRole.selector ||
			selector == this.getRoleAdmin.selector ||
			selector == this.getRoleMember.selector ||
			selector == this.grantRole.selector ||
			selector == this.revokeRole.selector ||
			selector == this.renounceRole.selector ||
			// minter & pauser
			selector == this.isMinter.selector ||
			selector == this.addMinter.selector ||
			selector == this.renounceMinter.selector ||
			selector == this.isPauser.selector ||
			selector == this.addPauser.selector ||
			selector == this.pause.selector ||
			selector == this.unpause.selector ||
			// ERC20 overrides
			selector == this.transfer.selector ||
			selector == this.transferFrom.selector ||
			// SuperfluidToken overrides
			selector == this.createAgreement.selector;
	}

	// ========================================================================================
	// ============== Functionality to be executed on the proxy via delegateCall ==============
	// ========================================================================================

	/// initializes state specific to the GoodDollar token
	/// When upgrading to a new logic contract,
	function initializeAux(
		uint256 _cap,
		IFeesFormula _formula,
		IIdentity _identity,
		address _feeRecipient,
		address _owner
	) public initializer {
		__AccessControl_init_unchained();
		__Pausable_init_unchained();
		_setupRole(DEFAULT_ADMIN_ROLE, _owner);
		_setupRole(MINTER_ROLE, _owner);
		_setupRole(PAUSER_ROLE, _owner);
		feeRecipient = _feeRecipient;
		identity = _identity;
		formula = _formula;
		cap = _cap;
	}

	// ============ AuxProxiable ============

	// new versions of the logic contract need to keep that return value
	// this check protects against accidentally updating to an incompatible contract
	function proxiableAuxUUID() public pure override returns (bytes32) {
		return keccak256("GoodDollarCustom.implementation");
	}

	function updateAuxCode(address newAddress) external override onlyOwner {
		AuxProxiable._updateCodeAddress(newAddress);
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

	// why is there no "renouncePauser"?

	function transferAndCall(
		address to,
		uint256 value,
		bytes calldata data
	) external override returns (bool) {
		// this will invoke the overriding transfer(),
		// where pause state and fees are considered
		return super._transferAndCall(to, value, data);
	}

	/// override ERC20 transfer function in order to make it pausable
	/// also required by ERC677
	function transfer(address to, uint256 value) public override returns (bool) {
		return transferFrom(msg.sender, to, value);
	}

	/// override ERC20 transferFrom function in order to make it pausable
	function transferFrom(
		address from,
		address to,
		uint256 value
	) public returns (bool) {
		require(!paused(), "Pausable: token transfer while paused");
		uint256 bruttoValue = _processFees(msg.sender, to, value);
		// handing over to the wrapper of SuperToken.transferFrom
		_transferFrom(from, msg.sender, to, bruttoValue);
		return true;
	}

	/// override Superfluid agreement function in order to make it pausable
	/// that is, no new streams can be started when the contract is paused
	function createAgreement(bytes32 id, bytes32[] calldata data) external {
		require(!paused(), "Pausable: createAgreement while paused");
		// otherwise the wrapper of SuperToken.createAgreement does the actual job
		_createAgreement(id, data);
	}

	/**
	 * @dev Minting function
	 * @param to the address that will receive the minted tokens
	 * @param value the amount of tokens to mint
	 */
	function mint(address to, uint256 value)
		public
		override(IGoodDollarCustom)
		onlyMinter
		returns (bool)
	{
		// TODO: may want to require ! paused()
		if (cap > 0) {
			require(
				_totalSupply() + value <= cap,
				"Cannot increase supply beyond cap"
			);
		}
		_mint(to, value, new bytes(0));
		return true;
	}

	function burnFrom(address account, uint256 amount) public {
		uint256 currentAllowance = allowance(account, _msgSender());
		require(currentAllowance >= amount, "ERC20: burn amount exceeds allowance");
		unchecked {
			_approve(account, _msgSender(), currentAllowance - amount);
		}
		_burn(account, amount, new bytes(0));
	}

	function burn(uint256 amount) public {
		// TODO: may want to require ! paused()
		_burn(msg.sender, amount, new bytes(0));
	}

	function getFees(uint256 value)
		public
		view
		returns (uint256 fee, bool senderPays)
	{
		return formula.getTxFees(value, address(0), address(0));
	}

	function getFees(
		uint256 value,
		address sender,
		address recipient
	) public view returns (uint256 fee, bool senderPays) {
		return formula.getTxFees(value, sender, recipient);
	}

	function setFeeRecipient(address _feeRecipient) public onlyOwner {
		feeRecipient = _feeRecipient;
	}

	// internal functions

	function _processFees(
		address account,
		address recipient,
		uint256 value
	) internal returns (uint256) {
		(uint256 txFees, bool senderPays) = getFees(value, account, recipient);
		if (txFees > 0 && !identity.isDAOContract(msg.sender)) {
			require(
				senderPays == false || value + txFees <= _balanceOf(account),
				"Not enough balance to pay TX fee"
			);
			_transferFrom(account, account, feeRecipient, txFees);
			return senderPays ? value : value - txFees;
		}
		return value;
	}
}

/*
hardhat:

(avafuji)
factoryAddr = "0xA25dbEa94C5824892006b30a629213E7Bf238624"

signer = await ethers.getSigner()
GDP = await ethers.getContractFactory("GoodDollarProxy")
GDL = await ethers.getContractFactory("GoodDollarLogic")

gdl = await GDL.deploy()
gdp = await GDP.deploy(gdl.address)

await gdp.initialize(factoryAddr, "test", "TST", signer.address)



*/
