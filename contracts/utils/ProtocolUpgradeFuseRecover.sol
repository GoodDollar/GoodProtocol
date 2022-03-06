// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/NameService.sol";
import "../Interfaces.sol";

/**
 a scheme that once approved in old AbsoluteVotingMachine will
 set initial settings and permissions for the new protocol contracts and revoke old permissions
 */
contract ProtocolUpgradeFuseRecover {
	Controller controller;
	address owner;
	address avatar;

	constructor(Controller _controller, address _owner) {
		controller = _controller;
		owner = _owner;
		avatar = address(controller.avatar());
	}

	function upgrade(
		INameService ns,
		address firstClaimPool, //schemeRegistrar,upgradeScheme, old ubi, firstclaim
		address ubiScheme,
		bytes32[] calldata nameHash,
		address[] calldata nameAddress
	) external {
		require(msg.sender == owner, "only owner");
		require(nameHash.length == nameAddress.length, "length mismatch");

		setNameServiceContracts(ns, nameHash, nameAddress);
		upgradeUBI(ubiScheme, firstClaimPool);
	}

	function upgradeUBI(address newUBI, address firstClaim) internal {
		IGoodDollar gd = IGoodDollar(Avatar(avatar).nativeToken());

		uint256 ubiBalance = gd.balanceOf(avatar);

		(bool ok, ) = controller.genericCall(
			address(firstClaim),
			abi.encodeWithSignature("setUBIScheme(address)", newUBI),
			address(avatar),
			0
		);
		require(ok, "setUBIScheme failed");

		(ok, ) = controller.genericCall(
			address(newUBI),
			abi.encodeWithSignature("setUseFirstClaimPool(bool)", false),
			address(avatar),
			0
		);
		require(ok, "setUseFirstClaimPool failed");

		if (ubiBalance > 0) {
			ok = controller.externalTokenTransfer(
				address(gd),
				newUBI,
				ubiBalance,
				address(avatar)
			);
			require(ok, "funds transfer to new ubischeme failed");
		}
	}

	/**
	 * unregister old voting schemes
	 * register new voting scheme with all DAO permissions
	 */
	function upgradeGovernance(
		address schemeRegistrar,
		address upgradeScheme,
		address compoundVotingMachine
	) public {
		require(msg.sender == owner, "only owner");

		require(
			controller.registerScheme(
				compoundVotingMachine,
				bytes32(0x0),
				bytes4(0x0000001F),
				avatar
			),
			"registering compoundVotingMachine failed"
		);

		require(
			controller.unregisterSelf(avatar),
			"unregistering ProtocolUpgradeFuse failed"
		);

		selfdestruct(payable(owner));
	}

	//set contracts in nameservice that are deployed after INameService is created
	//	FUND_MANAGER RESERVE REPUTATION GDAO_STAKING  GDAO_CLAIMERS ...
	function setNameServiceContracts(
		INameService ns,
		bytes32[] memory names,
		address[] memory addresses
	) internal {
		(bool ok, ) = controller.genericCall(
			address(ns),
			abi.encodeWithSignature(
				"setAddresses(bytes32[],address[])",
				names,
				addresses
			),
			avatar,
			0
		);
		require(ok, "Calling setNameServiceContracts failed");
	}
}
