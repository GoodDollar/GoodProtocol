// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/NameService.sol";
import "../Interfaces.sol";

// import "hardhat/console.sol";

interface MentoExchange {
	function reserve() external view returns (address);
}

contract ProtocolUpgradeV4Mento {
	struct PoolExchange {
		address reserveAsset;
		address tokenAddress;
		uint256 tokenSupply;
		uint256 reserveBalance;
		uint32 reserveRatio;
		uint32 exitContribution;
	}

	address avatar;

	constructor(address _avatar) {
		avatar = _avatar;
	}

	function upgrade(
		Controller _controller,
		PoolExchange memory _exchange,
		address _mentoExchange,
		address _mentoController,
		address _distHelper
	) external {
		require(msg.sender == address(avatar), "only avatar can call this");

		uint256 expansionFrequency = 1 days;
		uint256 expansionRate = 288617289021952; //10% a year = ((1e18 - expansionRate)/1e18)^365=0.9
		uint256 cUSDBalance = ERC20(_exchange.reserveAsset).balanceOf(
			MentoExchange(_mentoExchange).reserve()
		);
		require(cUSDBalance >= 200000e18, "not enough reserve");
		uint256 gdSupply = ERC20(_exchange.tokenAddress).totalSupply();
		uint256 price = 0.0001 ether; // we initialize with price of 0.0001
		// given price calculate the reserve ratio
		uint32 reserveRatio = uint32(
			(cUSDBalance * 1e18 * 1e8) / (price * gdSupply)
		); //cUSDBalance/(price * gdSupply/1e18) * 1e8
		uint32 exitContribution = 0.1 * 1e8;

		_exchange.reserveBalance = cUSDBalance;
		_exchange.tokenSupply = gdSupply;
		_exchange.reserveRatio = reserveRatio;
		_exchange.exitContribution = exitContribution;

		(bool ok, bytes memory result) = _controller.genericCall(
			address(_mentoExchange),
			abi.encodeWithSignature(
				"createExchange((address,address,uint256,uint256,uint32,uint32))",
				_exchange
			),
			address(avatar),
			0
		);

		// console.log("createExchange %s", ok);
		require(ok, "createExchange failed");
		bytes32 exchangeId = abi.decode(result, (bytes32));
		// console.logBytes32(exchangeId);
		(ok, ) = _controller.genericCall(
			address(_mentoController),
			abi.encodeWithSignature(
				"setExpansionConfig(bytes32,uint256,uint256)",
				exchangeId,
				expansionRate,
				expansionFrequency
			),
			address(avatar),
			0
		);
		require(ok, "setExpansionConfig failed");

		(ok, ) = _controller.genericCall(
			address(_mentoController),
			abi.encodeWithSignature("setDistributionHelper(address)", _distHelper),
			address(avatar),
			0
		);
		require(ok, "setDistribuitionHelper failed");

		// prevent executing again
		require(_controller.unregisterSelf(avatar), "unregistering failed");
		avatar = address(0);
	}
}
