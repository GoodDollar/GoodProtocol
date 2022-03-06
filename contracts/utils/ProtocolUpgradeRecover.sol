// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../Interfaces.sol";
import "../DAOStackInterfaces.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

/**
 a scheme that once approved in old AbsoluteVotingMachine is in charge of upgrading to new contracts
 */
contract ProtocolUpgradeRecover {
	Controller controller;
	address owner;
	address avatar;

	modifier onlyOwner() {
		require(msg.sender == owner, "only owner");
		_;
	}

	constructor(Controller _controller, address _owner) {
		controller = _controller;
		owner = _owner;
		avatar = address(controller.avatar());
	}

	/**
	1. set the DAO contracts in registery after they have been deployedDAO
	2. set the initial staking contracts and their rewards
	 */
	function upgradeBasic(
		INameService ns,
		bytes32[] calldata nameHash,
		address[] calldata nameAddress
	) external onlyOwner {
		require(nameHash.length == nameAddress.length, "length mismatch");

		_setNameServiceContracts(ns, nameHash, nameAddress);
	}

	//initialize rewards for v2 starting staking contracts
	function setStakingRewards(
		INameService ns,
		address[] memory contracts,
		uint256[] memory rewards
	) external onlyOwner {
		require(contracts.length == rewards.length, "staking length mismatch");
		for (uint256 i = 0; i < contracts.length; i++) {
			(bool ok, ) = controller.genericCall(
				ns.getAddress("FUND_MANAGER"),
				abi.encodeWithSignature(
					"setStakingReward(uint32,address,uint32,uint32,bool)",
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

	/**
	3. set new reserve as sole minter
	4. upgrade to new reserve
	 */
	function upgradeReserve(INameService ns) external onlyOwner {
		_setReserveSoleMinter(ns);

		_setNewReserve(ns);
	}

	function setReserveGDXAirdrop(INameService ns, bytes32 airdrop)
		external
		onlyOwner
	{
		(bool ok, ) = controller.genericCall(
			ns.getAddress("RESERVE"),
			abi.encodeWithSignature("setGDXAirdrop(bytes32)", airdrop),
			avatar,
			0
		);
		require(ok, "Calling setReserveGDXAirdrop failed");
	}

	receive() external payable {}

	/**
	 * 6. upgrade to new DAO and relinquish control
	 * register new voting scheme with all DAO permissions
	 * NOTICE: call this last to finalize DAO decentralization!!!
	 */
	function upgradeGovernance(address compoundVotingMachine) external onlyOwner {
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
			"unregistering protocolupgrade failed"
		);
		selfdestruct(payable(owner));
	}

	//add new reserve as minter
	//renounace minter from avatar
	//add reserve as global constraint on controller
	function _setReserveSoleMinter(INameService ns) internal {
		bool ok;
		(ok, ) = controller.genericCall(
			ns.getAddress("GOODDOLLAR"),
			abi.encodeWithSignature("addMinter(address)", ns.getAddress("RESERVE")),
			avatar,
			0
		);
		require(ok, "Calling addMinter failed");

		(ok, ) = controller.genericCall(
			address(ns.getAddress("GOODDOLLAR")),
			abi.encodeWithSignature("renounceMinter()"),
			avatar,
			0
		);
		require(ok, "Calling renounceMinter failed");

		ok = controller.addGlobalConstraint(
			ns.getAddress("RESERVE"),
			bytes32(0x0),
			avatar
		);

		require(ok, "Calling addGlobalConstraint failed");
	}

	//transfer funds(cdai + comp) from old reserve to new reserve/avatar
	//end old reserve
	//initialize new marketmaker with current cdai price, rr, reserves
	function _setNewReserve(INameService ns) internal {
		bool ok;

		address cdai = ns.getAddress("CDAI");
		uint256 oldReserveCdaiBalance = ERC20(cdai).balanceOf(avatar);

		ok = controller.externalTokenTransfer(
			cdai,
			ns.getAddress("RESERVE"),
			oldReserveCdaiBalance,
			avatar
		);

		require(ok, "transfer cdai to new reserve failed");

		(ok, ) = controller.genericCall(
			ns.getAddress("MARKET_MAKER"),
			abi.encodeWithSignature(
				"initializeToken(address,uint256,uint256,uint32,uint256)",
				cdai,
				604798140091,
				4325586750999495,
				805643,
				1645623572
			),
			avatar,
			0
		);

		require(ok, "calling marketMaker initializeToken failed");
	}

	//set contracts in nameservice that are deployed after INameService is created
	//	FUND_MANAGER RESERVE REPUTATION GDAO_STAKING  GDAO_CLAIMERS ...
	function _setNameServiceContracts(
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
