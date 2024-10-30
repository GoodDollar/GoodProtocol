// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../reserve/GoodReserveCDai.sol";
import "hardhat/console.sol";

contract ReserveRestore {
	NameService ns;
	uint256 public constant LOCKED_HACKED_FUNDS = 971921364208;
	bool public executed;

	constructor(NameService _ns) {
		ns = _ns;
	}

	function upgrade(address daiFrom) external {
		require(executed == false, "already upgraded");
		executed = true;
		address avatar = ns.dao().avatar();

		GoodReserveCDai reserve = GoodReserveCDai(ns.getAddress("RESERVE"));
		ERC20(ns.getAddress("DAI")).transferFrom(daiFrom, address(this), 200000e18);
		uint256 daiBalance = ERC20(ns.getAddress("DAI")).balanceOf(address(this));
		require(daiBalance >= 200000e18, "not enough reserve");
		cERC20 cdai = cERC20(ns.getAddress("CDAI"));
		ERC20 dai = ERC20(ns.getAddress("DAI"));

		dai.approve(address(cdai), daiBalance);
		//Mint cDAIs
		uint256 cDaiResult = cdai.mint(daiBalance);
		require(cDaiResult == 0, "Minting cDai failed");
		uint256 cdaiBalance = cdai.balanceOf(address(this));
		require(cdaiBalance > 0, "not cdai minted");
		cdai.transfer(address(reserve), cdaiBalance);
		cdaiBalance = cdai.balanceOf(address(reserve));

		uint256 gdSupply = ERC20(ns.getAddress("GOODDOLLAR")).totalSupply() -
			LOCKED_HACKED_FUNDS;
		console.log("supply: %s", gdSupply);
		// get 0.0001 dai price in cdai
		uint256 initialPriceCdai = (0.0001 * 1e8 * 1e28) /
			cdai.exchangeRateStored(); //excghange rate is at 1e28 precision rate/1e28=1 cdai price in dai mul by 1e8 to get in cdai precision
		console.log("initialPriceCdai: %s", initialPriceCdai);

		console.log("cdaiBalance: %s", cdaiBalance);

		// given price calculate the reserve ratio
		uint32 reserveRatio = uint32(
			(cdaiBalance * 1e2 * 1e6) / (initialPriceCdai * gdSupply)
		); // mul by 1e2 to cover gd precision, cdaibalance precision=initialprice, mul by 1e6 to receive result in the precision of reserveRatio(1e6)
		console.log("reserveRatio: %s", reserveRatio);
		Controller ctrl = Controller(ns.getAddress("CONTROLLER"));
		//     function initializeToken(
		// 	ERC20 _token,
		// 	uint256 _gdSupply,
		// 	uint256 _tokenSupply,
		// 	uint32 _reserveRatio,
		// 	uint256 _lastExpansion
		// )
		(bool ok, ) = ctrl.genericCall(
			address(reserve.getMarketMaker()),
			abi.encodeCall(
				GoodMarketMaker.initializeToken,
				(cdai, gdSupply, cdaiBalance, reserveRatio, block.timestamp)
			),
			address(avatar),
			0
		);
		require(ok, "initializeToken failed");
		// ContributionCalc(
		// 		ns.getAddress("CONTRIBUTION_CALCULATION")
		// 	).setContributionRatio(0.1*1e18,1e18);

		// exit contribution to 10%
		(ok, ) = ctrl.genericCall(
			address(ns.getAddress("CONTRIBUTION_CALCULATION")),
			abi.encodeCall(ContributionCalc.setContributionRatio, (0.1 * 1e18, 1e18)),
			address(avatar),
			0
		);
		require(ok, "setContributionRatio failed");

		(ok, ) = ctrl.genericCall(
			address(reserve),
			abi.encodeCall(GoodReserveCDai.setGDXDisabled, (true, true)),
			address(avatar),
			0
		);

		require(ok, "setContributionRatio failed");

		// prevent executing again
		require(ctrl.unregisterSelf(avatar), "unregistering failed");
	}
}
