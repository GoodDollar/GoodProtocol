// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/NameService.sol";
import "../Interfaces.sol";

interface OldMarketMaker {
	struct ReserveToken {
		// Determines the reserve token balance
		// that the reserve contract holds
		uint256 reserveSupply;
		// Determines the current ratio between
		// the reserve token and the GD token
		uint32 reserveRatio;
		// How many GD tokens have been minted
		// against that reserve token
		uint256 gdSupply;
	}

	function reserveTokens(address token)
		external
		view
		returns (ReserveToken memory);
}

/**
 a scheme that once approved in old AbsoluteVotingMachine will
 set initial settings and permissions for the new protocol contracts and revoke old permissions
 */
contract ProtocolUpgrade {
	Controller controller;
	address owner;
	address avatar;
	address comp = address(0xc00e94Cb662C3520282E6f5717214004A7f26888);

	constructor(Controller _controller) {
		controller = _controller;
		owner = msg.sender;
		avatar = address(controller.avatar());
	}

	function upgrade(
		NameService ns,
		address[] memory oldContracts, //oldReserve, oldStaking, schemeRegistrar,upgradeScheme, oldMarketMaker
		address compoundVotingMachine,
		bytes32[] calldata nameHash,
		address[] calldata nameAddress,
		address[] calldata staking,
		uint256[] calldata monthlyRewards
	) external {
		require(msg.sender == owner, "only owner");
		require(nameHash.length == nameAddress.length, "length mismatch");
		require(
			staking.length == monthlyRewards.length,
			"staking length mismatch"
		);
		require(oldContracts.length == 4, "old contracts size mismatch");

		setNameServiceContracts(ns, nameHash, nameAddress);

		setStakingRewards(ns, staking, monthlyRewards);

		setReserveSoleMinter(ns);

		upgradeToNewReserve(ns, oldContracts[0], oldContracts[4]);

		upgradeGovernance(
			oldContracts[2],
			oldContracts[3],
			compoundVotingMachine
		);

		selfdestruct(payable(owner));
	}

	//add new reserve as minter
	//renounace minter from avatar
	//add reserve as global constraint on controller
	function setReserveSoleMinter(NameService ns) internal {
		bool ok;
		(ok, ) = controller.genericCall(
			ns.addresses(ns.GOODDOLLAR()),
			abi.encodeWithSignature(
				"addMinter(address)",
				ns.addresses(ns.RESERVE())
			),
			avatar,
			0
		);
		require(ok, "Calling addMinter failed");

		(ok, ) = controller.genericCall(
			address(ns.addresses(ns.GOODDOLLAR())),
			abi.encodeWithSignature("renounceMinter()"),
			avatar,
			0
		);
		require(ok, "Calling renounceMinter failed");

		ok = controller.addGlobalConstraint(
			ns.addresses(ns.RESERVE()),
			bytes32(0x0),
			avatar
		);

		require(ok, "Calling addGlobalConstraint failed");
	}

	//TODO: transfer funds(cdai + comp) from old reserve to new reserve/avatar
	//initialize new marketmaker with current cdai price, rr, reserves
	function upgradeToNewReserve(
		NameService ns,
		address oldReserve,
		address oldMarketMaker
	) public {
		(bool ok, ) =
			controller.genericCall(
				oldReserve,
				abi.encodeWithSignature("recover(address)", comp),
				avatar,
				0
			);

		require(ok, "calling Reserve recover failed");

		(ok, ) = controller.genericCall(
			oldReserve,
			abi.encodeWithSignature("end()"),
			avatar,
			0
		);

		require(ok, "calling Reserve end failed");

		address cdai = ns.getAddress("CDAI");
		OldMarketMaker.ReserveToken memory rToken =
			OldMarketMaker(oldMarketMaker).reserveTokens(cdai);

		ok = controller.externalTokenTransfer(
			cdai,
			ns.addresses(ns.RESERVE()),
			rToken.reserveSupply,
			avatar
		);

		require(ok, "calling externalTokenTransfer failed");

		(ok, ) = controller.genericCall(
			ns.addresses(ns.MARKET_MAKER()),
			abi.encodeWithSignature(
				"initializeToken(address,uint256,uint256,uint32)",
				cdai,
				rToken.gdSupply,
				rToken.reserveSupply,
				rToken.reserveRatio
			),
			avatar,
			0
		);

		require(ok, "calling marketMaker initializeToken failed");
	}

	function upgradeGovernance(
		address schemeRegistrar,
		address upgradeScheme,
		address compoundVotingMachine
	) internal {
		address avatar = address(avatar);
		controller.unregisterScheme(schemeRegistrar, avatar);
		controller.unregisterScheme(upgradeScheme, avatar);
		controller.registerScheme(
			compoundVotingMachine,
			bytes32(0x0),
			bytes4(0x0000001F),
			avatar
		);
	}

	//set contracts in nameservice that are deployed after NameService is created
	//	FUND_MANAGER RESERVE REPUTATION GDAO_STAKING  GDAO_CLAIMERS ...
	function setNameServiceContracts(
		NameService ns,
		bytes32[] memory names,
		address[] memory addresses
	) internal {
		(bool ok, ) =
			controller.genericCall(
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

	//initialize rewards for v2 starting staking contracts
	function setStakingRewards(
		NameService ns,
		address[] memory contracts,
		uint256[] memory rewards
	) internal {
		for (uint256 i = 0; i < contracts.length; i++) {
			(bool ok, ) =
				controller.genericCall(
					ns.addresses(ns.FUND_MANAGER()),
					abi.encodeWithSignature(
						"setStakingRewards(uint32,address,uint32,uint32,bool)",
						rewards[i],
						contracts[i],
						0,
						0,
						false
					),
					avatar,
					0
				);
			require(ok, "Calling setStakingRewards failed");
		}
	}

	//stop old staking
	//recover COMP
	//TODO: ?? recover left over cDAI if stopped
	//TODO: withdraw donations and deposit in new staking contract
	function upgradeToNewStaking(
		NameService ns,
		address oldStaking,
		address donationStaking
	) internal {
		bool ok;
		(ok, ) = controller.genericCall(
			oldStaking,
			abi.encodeWithSignature("end()", 0, 0, false),
			avatar,
			0
		);
		require(ok, "Calling SimpleDAIStaking end failed");

		(ok, ) = controller.genericCall(
			oldStaking,
			abi.encodeWithSignature("recover(address)", comp, 0, 0, false),
			avatar,
			0
		);

		require(ok, "Calling SimpleDAIStaking recover(COMP) failed");
	}
}
