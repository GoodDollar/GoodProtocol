// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "./SegmentedUBIPool.sol";

contract SegmentedIdentity is DAOUpgradeableContract, AccessControlUpgradeable {
	struct PoolInfo {
		address creator;
		address inclusionAdmin;
		string description;
		address pool;
		IIdentity uniqueIdentity;
		bytes32 merkleDrop;
		mapping(bytes32 => address) identifierToMember;
		mapping(address => bool) members;
		uint256 membersCounts;
	}

	mapping(address => PoolInfo) public pools;
	mapping(address => address[]) public memberToPools;
	address foundationAdminWallet;
	address public ubiImpl;
	address proxyImpl;
	UpgradeableBeacon public ubiBeacon;

	modifier onlyInclusionAdmin(address pool) {
		_;
		//todo verify sender is admin
	}

	function initialize(
		INameService _ns,
		address _foundationAdminWallet,
		address _ubipoolBeacon
	) public initializer {
		setDAO(_ns);
		_setupRole(DEFAULT_ADMIN_ROLE, avatar);
		foundationAdminWallet = _foundationAdminWallet;
		// ubiImpl = new SegmentedUBIPool();//todo: restore
		// ubiBeacon = new UpgradeableBeacon(ubiImpl);
		// ubiBeacon.transferOwnership(avatar);
		// proxyImpl = new BeaconProxy();
	}

	function _createPool(address creator, string memory description)
		internal
		returns (address pool)
	{
		//todo: create a beaconproxy which uses the ubipoolBeacon. use create2 for deterministic address using params: creator/description
	}

	function setupPool(
		address inclusionAdmin,
		string memory description,
		bool allowFoundationAdmin,
		IIdentity uniqueness,
		bytes32 merkleDrop
	) public {
		address pool = _createPool(msg.sender, description);
		PoolInfo storage poolInfo = pools[pool];
		poolInfo.creator = msg.sender;
		poolInfo.inclusionAdmin = inclusionAdmin;
		poolInfo.uniqueIdentity = uniqueness;
		poolInfo.description = description;
		poolInfo.merkleDrop = merkleDrop;
		poolInfo.pool = pool;

		if (inclusionAdmin != address(0))
			_setupRole(keccak256(abi.encode("INCLUSION_", pool)), inclusionAdmin);
		if (allowFoundationAdmin && inclusionAdmin != foundationAdminWallet)
			_setupRole(
				keccak256(abi.encode("INCLUSION_", pool)),
				foundationAdminWallet
			);
	}

	function whitelistProof(
		address pool,
		address member,
		bytes32[] memory proof
	) public {
		//todo: verify proof and whitelist
	}

	function addMember(
		address pool,
		address member,
		bytes32 identifier
	) public onlyInclusionAdmin(pool) {
		//todo: should not fail if user already whitelisted, this can be used to also set the identifier of a member
		//add user to whitelisted pool list
		//add pool to user pools
		//add identifier to member
	}

	function removeMember(address pool, address member)
		public
		onlyInclusionAdmin(pool)
	{
		//todo: should not fail if user not in pool
		//remove user to whitelisted pool list
		//remove pool from user pools
	}

	function isWhitelisted(address pool, address member)
		public
		returns (bool isWhitelisted)
	{
		//todo: true if both member and whitelisted
	}

	function isPoolMember(address pool, address member)
		public
		view
		returns (bool isMember, bool isWhitelisted)
	{}

	function getPoolMemberByIdentifier(address pool, bytes32 identifier)
		public
		view
		returns (
			address member,
			bool isMember,
			bool isWhitelisted
		)
	{
		//todo: return
	}

	function modifyPool(
		address pool,
		address owner,
		address inclusionAdmin,
		IIdentity uniqueness,
		bool allowFoundationAdmin,
		bytes32 merkleDrop
	) public {
		require(msg.sender == pools[pool].creator, "not owner");
		//modify details and grant/revoke roles
	}
}
