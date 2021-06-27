// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/NameService.sol";
import "../Interfaces.sol";

/**
 a scheme that once approved in old AbsoluteVotingMachine will
 set initial settings and permissions for the new protocol contracts and revoke old permissions
 */
contract ProtocolUpgradeFuse {
	Controller controller;
	address owner;
	address avatar;

	constructor(Controller _controller) {
		controller = _controller;
		owner = msg.sender;
		avatar = address(controller.avatar());
	}

	function upgrade(
		INameService ns,
		address[] memory oldContracts, //schemeRegistrar,upgradeScheme, old ubi, firstclaim
		address compoundVotingMachine,
		address ubiScheme,
		bytes32[] calldata nameHash,
		address[] calldata nameAddress
	) external {
		require(msg.sender == owner, "only owner");
		require(nameHash.length == nameAddress.length, "length mismatch");

		require(oldContracts.length == 4, "old contracts size mismatch");

		upgradeUBI(oldContracts[2], ubiScheme, oldContracts[3]);
		setNameServiceContracts(ns, nameHash, nameAddress);

		upgradeGovernance(
			oldContracts[0],
			oldContracts[1],
			compoundVotingMachine
		);

		selfdestruct(payable(owner));
	}

	function upgradeUBI(
		address oldUBI,
		address newUBI,
		address firstClaim
	) internal {
		IGoodDollar gd = IGoodDollar(Avatar(avatar).nativeToken());

		uint256 ubiBalance = gd.balanceOf(oldUBI);

		(bool ok, ) = controller.genericCall(
			address(firstClaim),
			abi.encodeWithSignature("setUBIScheme(address)", newUBI),
			address(avatar),
			0
		);
		require(ok, "setUBIScheme failed");

		// transfer funds from old scheme here
		(ok, ) = controller.genericCall(
			oldUBI,
			abi.encodeWithSignature("end()"),
			address(avatar),
			0
		);
		require(ok, "old ubischeme end failed");

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
	) internal {
		require(
			controller.unregisterScheme(schemeRegistrar, avatar),
			"unregistering schemeRegistrar failed"
		);
		require(
			controller.unregisterScheme(upgradeScheme, avatar),
			"unregistering upgradeScheme failed"
		);
		require(
			controller.registerScheme(
				compoundVotingMachine,
				bytes32(0x0),
				bytes4(0x0000001F),
				avatar
			),
			"registering compoundVotingMachine failed"
		);
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
