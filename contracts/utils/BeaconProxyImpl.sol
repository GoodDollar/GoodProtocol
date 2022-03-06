// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

contract BeaconProxyImpl is BeaconProxy {
	constructor() BeaconProxy(address(0), "") {}

	/**
	 * @dev Initializes the proxy with `beacon`.
	 *
	 * If `data` is nonempty, it's used as data in a delegate call to the implementation returned by the beacon. This
	 * will typically be an encoded function call, and allows initializating the storage of the proxy like a Solidity
	 * constructor.
	 *
	 * Requirements:
	 *
	 * - `beacon` must be a contract with the interface {IBeacon}.
	 */
	function initialize(address beacon, bytes memory data) public payable {
		require(_getBeacon() == address(0), "initialized");

		assert(
			_BEACON_SLOT == bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)
		);
		_upgradeBeaconToAndCall(beacon, data, false);
	}
}
