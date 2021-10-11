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

	constructor(Controller _controller, address _owner) {
		controller = _controller;
		owner = _owner;
		avatar = address(controller.avatar());
	}

	function upgrade(
		INameService ns,
		address[] memory oldContracts, //schemeRegistrar,upgradeScheme, old ubi, firstclaim
		address ubiScheme,
		bytes32[] calldata nameHash,
		address[] calldata nameAddress
	) external {
		require(msg.sender == owner, "only owner");
		require(nameHash.length == nameAddress.length, "length mismatch");

		require(oldContracts.length == 4, "old contracts size mismatch");

		upgradeUBI(oldContracts[2], ubiScheme, oldContracts[3]);
		setNameServiceContracts(ns, nameHash, nameAddress);

		//identity has no need for special permissions, just needs to be registered
		require(
			controller.registerScheme(
				ns.getAddress("IDENTITY"),
				bytes32(0x0),
				bytes4(0x00000001),
				avatar
			),
			"registering Identity failed"
		);

		//if we are really doing an upgrade and not deploying dev env which will not have formula
		if (oldContracts[0] != address(0)) {
			//formula has no need to be a registered scheme
			require(
				controller.unregisterScheme(
					IGoodDollar(ns.getAddress("GOODDOLLAR")).formula(),
					avatar
				),
				"unregistering formula failed"
			);
		}
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

		if (oldUBI != address(0)) {
			// transfer funds from old scheme here
			(ok, ) = controller.genericCall(
				oldUBI,
				abi.encodeWithSignature("end()"),
				address(avatar),
				0
			);
			require(ok, "old ubischeme end failed");

			require(
				controller.unregisterScheme(oldUBI, avatar),
				"unregistering old UBIScheme failed"
			);
		}

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

		if (schemeRegistrar != address(0))
			require(
				controller.unregisterScheme(schemeRegistrar, avatar),
				"unregistering schemeRegistrar failed"
			);

		if (upgradeScheme != address(0))
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

		require(
			controller.registerScheme(
				owner,
				bytes32(0x0),
				bytes4(0x0000001F),
				avatar
			),
			"registering gov failsafe failed"
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
