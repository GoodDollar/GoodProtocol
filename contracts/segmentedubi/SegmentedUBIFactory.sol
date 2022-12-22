// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import "@openzeppelin/contracts/proxy/Clones.sol";
import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../utils/BeaconProxyImpl.sol";

import "../Interfaces.sol";
import "./SegmentedUBIPool.sol";

contract SegmentedUBIFactory {
	SegmentedUBIPool public ubiImpl = new SegmentedUBIPool();
	BeaconProxyImpl proxyImpl = new BeaconProxyImpl();
	UpgradeableBeacon public ubiBeacon = new UpgradeableBeacon(address(ubiImpl));

	constructor(address avatar) {
		ubiBeacon.transferOwnership(avatar);
	}

	function createPoolAndInitialize(
		address creator,
		string memory description,
		bytes memory data
	) external returns (address pool) {
		address proxy = Clones.cloneDeterministic(
			address(proxyImpl),
			keccak256(abi.encode(creator, description))
		);
		BeaconProxyImpl(payable(proxy)).initialize(address(ubiBeacon), data);
		return proxy;
	}
}
