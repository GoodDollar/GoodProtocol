// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../Interfaces.sol";
import "../DAOStackInterfaces.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

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
 a scheme that once approved in old AbsoluteVotingMachine is in charge of upgrading to new contracts
 */
contract ProtocolUpgrade {
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
		address[] calldata nameAddress,
		address[] calldata staking,
		uint256[] calldata monthlyRewards
	) external onlyOwner {
		require(nameHash.length == nameAddress.length, "length mismatch");
		require(staking.length == monthlyRewards.length, "staking length mismatch");

		_setNameServiceContracts(ns, nameHash, nameAddress);

		_setStakingRewards(ns, staking, monthlyRewards);

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

		//formula has no need to be a registered scheme
		address formula = IGoodDollar(ns.getAddress("GOODDOLLAR")).formula();
		if (controller.isSchemeRegistered(formula, avatar))
			require(
				controller.unregisterScheme(
					IGoodDollar(ns.getAddress("GOODDOLLAR")).formula(),
					avatar
				),
				"unregistering formula failed"
			);
	}

	/**
	3. set new reserve as sole minter
	4. upgrade to new reserve
	 */
	function upgradeReserve(
		INameService ns,
		address oldReserve,
		address oldMarketMaker,
		address oldFundManager,
		address COMP
	) external onlyOwner {
		_setReserveSoleMinter(ns);

		if (oldReserve != address(0)) {
			_setNewReserve(ns, oldReserve, oldMarketMaker, COMP);

			require(
				controller.unregisterScheme(oldFundManager, avatar),
				"unregistering old FundManager failed"
			);
		}
	}

	/**
	5. upgrade donation staking contract
	 */
	function upgradeDonationStaking(
		INameService ns,
		address oldDonationStaking,
		address payable donationStaking,
		address oldSimpleDAIStaking
	) public onlyOwner {
		bool ok;
		bytes memory result;

		(ok, result) = controller.genericCall(
			oldDonationStaking,
			abi.encodeWithSignature("end()"),
			avatar,
			0
		);

		require(ok, "Calling oldDonationStaking end failed");
		(uint256 dai, uint256 eth) = abi.decode(result, (uint256, uint256));
		ok = controller.externalTokenTransfer(
			ns.getAddress("DAI"),
			donationStaking,
			dai,
			avatar
		);

		require(ok, "Calling DAI externalTokenTransfer failed");
		if (eth > 0) {
			ok = controller.sendEther(eth, payable(this), avatar);

			require(ok, "Calling  sendEther failed");

			AddressUpgradeable.sendValue(donationStaking, eth);
		}
		IDonationStaking(donationStaking).stakeDonations();

		(ok, result) = controller.genericCall(
			oldSimpleDAIStaking,
			abi.encodeWithSignature("end()"),
			avatar,
			0
		);

		require(ok, "Calling old SimpleDAIStaking end failed");

		require(
			controller.unregisterScheme(oldSimpleDAIStaking, avatar),
			"unregistering old SimpleDAIStaking failed"
		);
	}

	receive() external payable {}

	/**
	 * 6. upgrade to new DAO and relinquish control
	 * unregister old voting schemes
	 * register new voting scheme with all DAO permissions
	 * NOTICE: call this last to finalize DAO decentralization!!!
	 */
	function upgradeGovernance(
		address schemeRegistrar,
		address upgradeScheme,
		address compoundVotingMachine
	) public onlyOwner {
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
			"registering governance failsafe failed"
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
	function _setNewReserve(
		INameService ns,
		address oldReserve,
		address oldMarketMaker,
		address COMP
	) internal {
		bool ok;
		if (COMP != address(0x0)) {
			(ok, ) = controller.genericCall(
				oldReserve,
				abi.encodeWithSignature("recover(address)", COMP),
				avatar,
				0
			);

			require(ok, "calling Reserve comp recover failed");
		}

		address cdai = ns.getAddress("CDAI");
		uint256 oldReserveCdaiBalance = ERC20(cdai).balanceOf(oldReserve);
		(ok, ) = controller.genericCall(
			oldReserve,
			abi.encodeWithSignature("end()"),
			avatar,
			0
		);

		require(ok, "calling Reserve end failed");

		OldMarketMaker.ReserveToken memory rToken = OldMarketMaker(oldMarketMaker)
			.reserveTokens(cdai);
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
				rToken.gdSupply,
				rToken.reserveSupply,
				rToken.reserveRatio,
				0
			),
			avatar,
			0
		);

		require(ok, "calling marketMaker initializeToken failed");

		require(
			controller.unregisterScheme(oldReserve, avatar),
			"unregistering old reserve failed"
		);
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

	//initialize rewards for v2 starting staking contracts
	function _setStakingRewards(
		INameService ns,
		address[] memory contracts,
		uint256[] memory rewards
	) internal {
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
}
