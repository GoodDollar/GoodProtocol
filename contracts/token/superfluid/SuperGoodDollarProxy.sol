// SPDX-License-Identifier: MIT
import { CustomSuperTokenBase } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/CustomSuperTokenBase.sol";
import { ISuperfluid, ISuperToken, ISuperTokenFactory } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { UUPSProxy } from "@superfluid-finance/ethereum-contracts/contracts/upgradability/UUPSProxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

pragma solidity >=0.8;

import "./AuxProxiable.sol";
import "./SuperGoodDollar.sol";

/**
 * @title Proxy for a GoodDollar V2.
 * delegates to both SuperToken logic and GoodDollar logic.
 * NOTE: This contract adds no storage slots. If that changes,
 * corresponding padding needs to be added to `GoodDollarCustom` right after `SuperTokenBase`
 */
contract SuperGoodDollarProxy is
	CustomSuperTokenBase, // adds 32 storage slots
	UUPSProxy
{
	/// @dev initializes the proxy with 2 logic contracts to delegate to
	/// NOTE DO NOT directly call initializeProxy() !
	function initialize(
		ISuperfluid sfHost,
		SuperGoodDollar auxLogic,
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
		ISuperToken(address(this)).initialize(IERC20(address(0)), 18, name, symbol);
		// this invokes the Initializer of AuxProxiable of the secondary (aux) logic contract
		ISuperGoodDollar(address(this)).initializeAux(
			cap,
			formula,
			identity,
			feeRecipient,
			owner
		);
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
