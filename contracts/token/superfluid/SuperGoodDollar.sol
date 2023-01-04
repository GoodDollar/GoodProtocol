// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

import "../ERC677.sol";
import "../FeesFormula.sol";
import "../../Interfaces.sol";
import "./AuxProxiable.sol";
import "./SuperTokenBase.sol";
import "./ISuperGoodDollar.sol";
import "./ERC20Permit.sol";

// IMPORTANT: The order of base contracts with storage MUST REMAIN AS IS after the initial deployment.
// Changing order can result in storage corruption when upgrading.
contract SuperGoodDollar is
	SuperTokenBase, // includes 32 storage slots padding for SuperToken
	AccessControlEnumerableUpgradeable, // with storage
	PausableUpgradeable, // with storage
	ERC20Permit, //with storage
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
			// ERC20Permit overrides
			selector == this.nonces.selector ||
			selector == this.DOMAIN_SEPARATOR.selector ||
			selector == this.permit.selector ||
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
		__ERC20Permit_init(_name());
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

	// ============ SuperFluid ============

	/// override Superfluid agreement function in order to make it pausable
	/// that is, no new streams can be started when the contract is paused
	function createAgreement(bytes32 id, bytes32[] calldata data) external {
		require(!paused(), "Pausable: createAgreement while paused");
		// otherwise the wrapper of SuperToken.createAgreement does the actual job
		_createAgreement(id, data);
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
	 * @param value the amount to transfer
	 * @param data The data to pass to transferAndCall
	 * @return a bool indicating if transfer function succeeded
	 */
	function transferAndCall(
		address to,
		uint256 value,
		bytes calldata data
	) external override returns (bool) {
		// this will invoke the overriding transfer(),
		// where pause state and fees are considered
		return super._transferAndCall(to, value, data);
	}

	/**
	 * @dev Processes fees from given value and sends
	 * remainder to given address
	 * override ERC20 transfer function in order to make it pausable
	 * also required by ERC677
	 * @param to the address to be sent to
	 * @param value the value to be processed and then
	 * transferred
	 * @return a boolean that indicates if the operation was successful
	 */
	function transfer(address to, uint256 value) public override returns (bool) {
		return transferFrom(msg.sender, to, value);
	}

	/**
	 * @dev Processes fees from given value and sends
	 * remainder to given address
	 * override ERC20 transfer function in order to make it pausable
	 * @param from The address which you want to send tokens from
	 * @param to the address to be sent to
	 * @param value the value to be processed and then
	 * transferred
	 * @return a boolean that indicates if the operation was successful
	 */
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
		require(!paused(), "Pausable: token transfer while paused");

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
		uint256 currentAllowance = _allowance(account, _msgSender());
		require(currentAllowance >= amount, "ERC20: burn amount exceeds allowance");
		require(!paused(), "Pausable: token transfer while paused");

		unchecked {
			_approve(account, _msgSender(), currentAllowance - amount);
		}
		_burn(account, amount, new bytes(0));
	}

	function burn(uint256 amount) public {
		require(!paused(), "Pausable: token transfer while paused");

		_burn(msg.sender, amount, new bytes(0));
	}

	/**
	 * @dev Gets the current transaction fees
	 * @return fee senderPays  that represents the current transaction fees and bool true if sender pays the fee or receiver
	 */
	function getFees(uint256 value)
		public
		view
		returns (uint256 fee, bool senderPays)
	{
		return formula.getTxFees(value, address(0), address(0));
	}

	/**
	 * @dev Gets the current transaction fees
	 * @return fee senderPays  that represents the current transaction fees and bool true if sender pays the fee or receiver
	 */
	function getFees(
		uint256 value,
		address sender,
		address recipient
	) public view returns (uint256 fee, bool senderPays) {
		return formula.getTxFees(value, sender, recipient);
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
	 * @param value The amount to subtract fees from
	 * @return an uint256 that represents the given value minus the transactional fees
	 */
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
