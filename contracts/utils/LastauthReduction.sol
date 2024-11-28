// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../reserve/GoodReserveCDai.sol";
import "../identity/IdentityV2.sol";
import "hardhat/console.sol";

contract LastauthReduction {
	NameService ns;

	uint public reduceByDays = 90;
	uint public startingPeriodDays = 180 + 90 * 5;
	uint public finalPeriod = 180;
	address public manager;

	constructor(NameService _ns) {
		ns = _ns;
		manager = msg.sender;
	}

	function reduce() external {
		require(msg.sender == manager, "not manager");

		address avatar = ns.dao().avatar();

		IdentityV2 id = IdentityV2(ns.getAddress("IDENTITY"));

		Controller ctrl = Controller(ns.getAddress("CONTROLLER"));
		uint curPeriod = id.authenticationPeriod();

		IIdentity oldId = id.oldIdentity();

		if (curPeriod <= finalPeriod) {
			// prevent executing again
			require(ctrl.unregisterSelf(avatar), "unregistering failed");
			return;
		}

		bool ok;
		if (curPeriod > startingPeriodDays) {
			(ok, ) = ctrl.genericCall(
				address(id),
				abi.encodeCall(
					IdentityV2.setAuthenticationPeriod,
					(startingPeriodDays)
				),
				address(avatar),
				0
			);
			require(ok, "setAuthenticationPeriod failed");

			if (address(oldId) != address(0)) {
				(ok, ) = ctrl.genericCall(
					address(oldId),
					abi.encodeCall(
						IdentityV2.setAuthenticationPeriod,
						(startingPeriodDays)
					),
					address(avatar),
					0
				);
				require(ok, "setAuthenticationPeriod failed");
			}
		} else {
			(ok, ) = ctrl.genericCall(
				address(id),
				abi.encodeCall(
					IdentityV2.setAuthenticationPeriod,
					(curPeriod - reduceByDays)
				),
				address(avatar),
				0
			);
			require(ok, "setAuthenticationPeriod failed");

			if (address(oldId) != address(0)) {
				(ok, ) = ctrl.genericCall(
					address(oldId),
					abi.encodeCall(
						IdentityV2.setAuthenticationPeriod,
						(curPeriod - reduceByDays)
					),
					address(avatar),
					0
				);
				require(ok, "setAuthenticationPeriod failed");
			}
		}
	}
}
