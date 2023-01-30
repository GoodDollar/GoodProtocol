// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-IERC20PermitUpgradeable.sol";
import { ISuperToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/CustomSuperTokenBase.sol";
import "../FeesFormula.sol";
import "../../Interfaces.sol";

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

interface ISuperGoodDollar is
	IGoodDollarCustom,
	ISuperToken,
	IERC20PermitUpgradeable
{
	function initialize(
		string calldata name,
		string calldata symbol,
		uint256 _cap,
		IFeesFormula _formula,
		IIdentity _identity,
		address _feeRecipient,
		address _owner
	) external;
}
