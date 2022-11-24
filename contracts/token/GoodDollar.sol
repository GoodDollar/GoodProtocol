// SPDX-License-Identifier: MIT

pragma solidity >=0.8;
import "./ERC677.sol";
import "./FeesFormula.sol";
import "../Interfaces.sol";
import "./ERC20PresetMinterPauserUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {
	ISuperfluid,
	ISuperToken,
	ISuperTokenFactory
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {
	ISuperToken,
	CustomSuperTokenBase
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/CustomSuperTokenBase.sol";
import { UUPSProxy } from "@superfluid-finance/ethereum-contracts/contracts/upgradability/UUPSProxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

abstract contract SuperTokenBase is CustomSuperTokenBase {
	//uint256[32] internal _storagePaddings; // added by CustomSuperTokenBase

	/// @dev Gets totalSupply
	/// @return t total supply
	function _totalSupply() internal view returns (uint256 t) {
		return ISuperToken(address(this)).totalSupply();
	}

	/// @dev Internal mint, calling functions should perform important checks!
	/// @param account Address receiving minted tokens
	/// @param amount Amount of tokens minted
	/// @param userData Optional user data for ERC777 send callback
	function _mint(address account, uint256 amount, bytes memory userData) internal {
		ISuperToken(address(this)).selfMint(account, amount, userData);
	}

	/// @dev Internal burn, calling functions should perform important checks!
	/// @param from Address from which to burn tokens
	/// @param amount Amount to burn
	/// @param userData Optional user data for ERC777 send callback
	function _burn(address from, uint256 amount, bytes memory userData) internal {
		ISuperToken(address(this)).selfBurn(from, amount, userData);
	}

	/// @dev Internal approve, calling functions should perform important checks!
	/// @param account Address of approving party
	/// @param spender Address of spending party
	/// @param amount Approval amount
	function _approve(address account, address spender, uint256 amount) internal {
		ISuperToken(address(this)).selfApproveFor(account, spender, amount);
	}

	/// @dev Internal transferFrom, calling functions should perform important checks!
	/// @param holder Owner of the tranfserred tokens
	/// @param spender Address of spending party (approved/operator)
	/// @param recipient Address of recipient party
	/// @param amount Amount to be tranfserred
	function _transferFrom(
		address holder,
		address spender,
		address recipient,
		uint256 amount
	) internal {
		ISuperToken(address(this)).selfTransferFrom(holder, spender, recipient, amount);
	}
}

// minimal interface for an auxiliary logic contract
interface IAuxLogic {
	// returns true if calls matching the given selector shall be delegated ot the auxiliary logic contract
	function implementsFn(bytes4 selector) external pure returns(bool);
}

abstract contract ProxyStoragePadding {
	uint256[1] internal _proxyStoragePaddings; // reserve 1 slot for the address of the 2nd logic contract
}

/**
 * @title The GoodDollar V2 token contract proxy
 * delegates to both SuperToken logic and GoodDollar logic
 */
contract GoodDollarProxy is
	CustomSuperTokenBase, // adds 32 storage slots
	Ownable, // adds 1 storage slot
	UUPSProxy
{
	IAuxLogic internal _auxLogic;

	// The first version of the auxiliary logic can already be defined when deploying.
	constructor(IAuxLogic auxLogic) {
		_auxLogic = auxLogic;
	}

	// Allows upgrading to a new version of auxLogic.
	// The caller is fully responsible for keeping compatibility with the previous storage structure when upgrading.
	// An incompatible new logic contract can brick the whole contract, e.g. by omitting storage paddings.
	event AuxLogicUpgraded(IAuxLogic newAuxLogix);
	function upgradeAuxLogic(IAuxLogic newAuxLogic) external onlyOwner {
		_auxLogic = newAuxLogic;
		emit AuxLogicUpgraded(newAuxLogic);
	}

	/// @dev Initializes SuperToken functionality through its factory
	/// should be called instead of initializeProxy()!
	/// @param factory super token factory for initialization
	/// @param name super token name
	/// @param symbol super token symbol
	function initialize(ISuperTokenFactory factory, string memory name, string memory symbol, address _owner)
		external
	{
		factory.initializeCustomSuperToken(address(this));
		ISuperToken(address(this)).initialize(IERC20(address(0)), 18, name, symbol);
		if (_owner != msg.sender) {
			transferOwnership(_owner);
		}
	}

	// Dispatcher for all other calls
	// Checks if the auxLogic wants to handle before delegating to the UUPSProxy implementation.
	function _fallback() internal virtual override {
		_beforeFallback();

		// check if it targets the auxLogic
		if (_auxLogic.implementsFn(msg.sig)) {
			_delegate(address(_auxLogic));
		} else {
			_delegate(_implementation());
		}
	}

}

interface IGoodDollarCustom {
	function feeRecipient() external returns(address);
	function formula() external returns(IFeesFormula);
	function identity() external returns(IIdentity);
	function cap() external returns(uint256);

	function setFormula(IFeesFormula _formula) external;
	function setIdentity(IIdentityV2 _identity) external;
	function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);
	function mint(address to, uint256 value) external returns (bool);

}

contract GoodDollarLogic is
	SuperTokenBase,
	Ownable,
	ProxyStoragePadding,
	Initializable,
	ERC677, // base contract without storage
	IAuxLogic,
	IGoodDollarCustom
{
	// IMPORTANT! Never change the type (storage size) or order of state variables.
	// If a variable isn't needed anymore, leave it as padding.
	address public feeRecipient;

	IFeesFormula public formula;

	IIdentity public identity;

	uint256 public cap;

	// Append new state variables here!



	// allows to mark the logic contract itself as initialized
	function markAsInitialized() public initializer {}

	// Allows the proxy to check if this contract wants to handle a given call.
	// All functions supposed to be reachable via proxy need to be included here.
	function implementsFn(bytes4 selector) external override pure returns(bool) {
		return
			selector == this.initializeAux.selector ||
			selector == this.feeRecipient.selector ||
			selector == this.formula.selector ||
			selector == this.identity.selector ||
			selector == this.cap.selector ||
			selector == this.setFormula.selector ||
			selector == this.setIdentity.selector ||
			selector == this.transferAndCall.selector ||
			selector == this.mint.selector
		;
	}

	// ============== Functionality to be executed on the proxy via delegateCall ==============

	/**
	 * @dev constructor
	 * @param _cap the cap of the token. no cap if 0
	 * @param _formula the fee formula contract
	 * @param _identity the identity contract
	 * @param _feeRecipient the address that receives transaction fees
	 */
	function initializeAux(
		uint256 _cap,
		IFeesFormula _formula,
		IIdentity _identity,
		address _feeRecipient
	) public initializer {
		feeRecipient = _feeRecipient;
		identity = _identity;
		formula = _formula;
		cap = _cap;
	}

	function setFormula(IFeesFormula _formula) external override onlyOwner {
		formula = _formula;
	}

	function setIdentity(IIdentityV2 _identity) external override onlyOwner {
		identity = _identity;
	}

	/*
	function isMinter(address _minter) external view returns (bool) {
		return hasRole(MINTER_ROLE, _minter);
	}

	function addMinter(address _minter) external {
		grantRole(MINTER_ROLE, _minter);
	}

	function renounceMinter() external {
		renounceRole(MINTER_ROLE, _msgSender());
	}

	function addPauser(address _pauser) external {
		grantRole(PAUSER_ROLE, _pauser);
	}

	function isPauser(address _pauser) external view returns (bool) {
		return hasRole(PAUSER_ROLE, _pauser);
	}
	*/

	/**
	 * @dev Processes fees from given value and sends
	 * remainder to given address
	 * @param to the address to be sent to
	 * @param value the value to be processed and then
	 * transferred
	 * @return a boolean that indicates if the operation was successful
	 */
	/*
	function transfer(address to, uint256 value)
		public
		override(ERC20Upgradeable, ERC677)
		returns (bool)
	{
		uint256 bruttoValue = _processFees(msg.sender, to, value);
		return ERC20Upgradeable.transfer(to, bruttoValue);
	}
	*/

	/**
	 * @dev Transfer tokens from one address to another
	 * @param from The address which you want to send tokens from
	 * @param to The address which you want to transfer to
	 * @param value the amount of tokens to be transferred
	 * @return a boolean that indicates if the operation was successful
	 */
	/*
	function transferFrom(
		address from,
		address to,
		uint256 value
	) public override returns (bool) {
		uint256 bruttoValue = _processFees(from, to, value);
		return super.transferFrom(from, to, bruttoValue);
	}
	*/

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
		//uint256 bruttoValue = _processFees(msg.sender, to, value);
		uint256 bruttoValue = value;
		return super._transferAndCall(to, bruttoValue, data);
	}
	// override for transferAndCall
	function _transfer(address to, uint256 value) internal override returns (bool) {
		_transferFrom(msg.sender, msg.sender, to, value);
		return true;
	}

	/**
	 * @dev Minting function
	 * @param to the address that will receive the minted tokens
	 * @param value the amount of tokens to mint
	 */
	function mint(address to, uint256 value) public override onlyOwner returns (bool) {
		if (cap > 0) {
			require(
				_totalSupply() + value <= cap,
				"Cannot increase supply beyond cap"
			);
		}
		_mint(to, value, new bytes(0));
		return true;
	}
}

interface ISuperGoodDollar is IGoodDollarCustom, ISuperToken {}


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