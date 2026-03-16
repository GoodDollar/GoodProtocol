// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../DAOStackInterfaces.sol";
import "../MentoInterfaces.sol";

import "hardhat/console.sol";

interface MentoExchange {
	function reserve() external view returns (address);
}

/**
 * @notice set the new reserve ratio on Celo for xdc reserve deploy
 */
contract UpdateReserveRatio {
	address owner;

	constructor(address _owner) {
		owner = _owner;
	}

	function upgrade(
		Controller _controller,
		address _mentoExchange,
		bytes32 _exchangeId,
		uint32 _reserveRatio,
		uint256 _verifyCurrentSupply,
		uint256 _newTotalSupply
	) external {
		require(msg.sender == owner, "only owner can call this");
		address avatar = _controller.avatar();
		//verify that the total supply the new reserve ratio was based on still applies
		require(
			ERC20(Avatar(avatar).nativeToken()).totalSupply() == _verifyCurrentSupply,
			"total supply mismatch"
		);

		if (block.chainid == 42220) {
			IBancorExchangeProvider.PoolExchange
				memory _exchange = IBancorExchangeProvider(_mentoExchange)
					.getPoolExchange(_exchangeId);

			_exchange.reserveRatio = _reserveRatio;
			_exchange.tokenSupply = _newTotalSupply;

			(bool ok, bytes memory result) = _controller.genericCall(
				address(_mentoExchange),
				abi.encodeCall(
					IBancorExchangeProvider.updateExchange,
					(_exchangeId, _exchange)
				),
				address(avatar),
				0
			);

			require(ok, "update failed");
			console.log("update done");
			bool updated = abi.decode(result, (bool));
			require(updated, "not updated");
		} else {
			IBancorExchangeProvider.PoolExchange memory _exchange;

			_exchange.reserveRatio = _reserveRatio;
			_exchange.tokenSupply = _newTotalSupply;
			_exchange.reserveAsset = 0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1; //usdc on xdc
			_exchange.tokenAddress = Avatar(avatar).nativeToken();
			_exchange.reserveBalance = 200000 * 1e6; // 200k USDC on xdc
			_exchange.exitContribution = 10000000; //10%

			(bool ok, bytes memory result) = _controller.genericCall(
				address(_mentoExchange),
				abi.encodeCall(IBancorExchangeProvider.createExchange, (_exchange)),
				address(avatar),
				0
			);

			require(ok, "create failed");
			console.log("create done");
			bytes32 created = abi.decode(result, (bytes32));
			console.logBytes32(created);
			require(created != bytes32(0), "not created");
		}
		owner = address(0); //mark as run;
		// prevent executing again
		require(_controller.unregisterSelf(avatar), "unregistering failed");
	}
}

contract CreateReserveExchange {
	address owner;

	constructor(address _owner) {
		owner = _owner;
	}

	function upgrade(
		Controller _controller,
		address _mentoExchange,
		IBancorExchangeProvider.PoolExchange memory _exchange
	) external {
		require(msg.sender == owner, "only owner can call this");
		address avatar = _controller.avatar();

		(bool ok, ) = _controller.genericCall(
			address(_mentoExchange),
			abi.encodeCall(IBancorExchangeProvider.createExchange, _exchange),
			address(avatar),
			0
		);

		// console.log("createExchange %s", ok);
		require(ok, "createExchange failed");

		owner = address(0); //mark as run;
		// prevent executing again
		require(_controller.unregisterSelf(avatar), "unregistering failed");
	}
}
