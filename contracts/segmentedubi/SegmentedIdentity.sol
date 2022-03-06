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
import "./SegmentedUBIFactory.sol";

contract SegmentedIdentity is DAOUpgradeableContract, AccessControlUpgradeable {
	struct PoolInfo {
		address creator;
		address membersAdmin;
		string description;
		address pool;
		IIdentity uniqueIdentity;
		bytes32 merkleDrop;
		mapping(bytes32 => address) identifierToMember;
		mapping(address => bool) members;
		uint256 membersCount;
	}

	mapping(address => PoolInfo) public pools;
	mapping(address => address[]) public memberToPools;
	address foundationAdminWallet;

	modifier onlyMembersAdmin(address pool) {
		require(
			pools[pool].membersAdmin == msg.sender,
			"SegIdentity: only members admin"
		);
		_;
	}

	function initialize(
		INameService _ns,
		address _foundationAdminWallet,
		address _ubipoolBeacon
	) public initializer {
		setDAO(_ns);
		_setupRole(DEFAULT_ADMIN_ROLE, avatar);
		foundationAdminWallet = _foundationAdminWallet;
	}

	function setupPool(
		address membersAdmin,
		string memory description,
		bool allowFoundationAdmin,
		IIdentity uniqueness,
		bytes32 merkleDrop
	) public {
		PoolInfo storage poolInfo = pools[address(pool)];
		poolInfo.creator = msg.sender;
		poolInfo.membersAdmin = membersAdmin;
		poolInfo.uniqueIdentity = uniqueness;
		poolInfo.description = description;
		poolInfo.merkleDrop = merkleDrop;

		//function initialize(INameService _ns,uint256 _maxInactiveDays,uint256 _dailyCap,bool _isDAOOwned,address _owner,bool _canWithdrawFunds)
		address pool = SegmentedUBIFactory(
			nameService.getAddress("SEGMENTEDUBI_FACTORY")
		).createPoolAndInitialize(
				creator,
				description,
				abi.encodeWithSignature(
					"initialize(address,uint256,uint256,bool,address,bool)",
					nameService,
					7,
					6000,
					true,
					address(0),
					true
				)
			);

		poolInfo.pool = address(pool);

		if (membersAdmin != address(0))
			_setupRole(keccak256(abi.encode("INCLUSION_", pool)), membersAdmin);
		if (allowFoundationAdmin && membersAdmin != foundationAdminWallet)
			_setupRole(
				keccak256(abi.encode("INCLUSION_", pool)),
				foundationAdminWallet
			);
	}

	function addMemberWithProof(
		address pool,
		bytes32 memberIdentifier,
		bytes32[] memory proof,
		uint256 proofIndex
	) public {
		bytes32 leafHash = keccak256(abi.encode(msg.sender, memberIdentifier));
		bool isValidProof = checkProofOrdered(
			proof,
			pools[pool].merkleDrop,
			leafHash,
			proofIndex
		);
		require(isValidProof, "invalid proof");
		_addMember(pool, msg.sender, memberIdentifier);
	}

	function addMember(
		address pool,
		address member,
		bytes32 identifier
	) public onlyMembersAdmin(pool) {
		_addMember(pool, member, identifier);
	}

	function _addMember(
		address pool,
		address member,
		bytes32 identifier
	) internal {
		if (pools[pool].members[member] == false) {
			pools[pool].members[member] = true;
			pools[pool].membersCount += 1;
			memberToPools[member].push(pool);
		}

		if (identifier != "") {
			require(
				pools[pool].identifierToMember[identifier] == address(0),
				"identifier exists"
			);
			pools[pool].identifierToMember[identifier] = member;
		}
	}

	function removeMember(address pool, address member)
		public
		onlyMembersAdmin(pool)
	{
		//todo: should not fail if user not in pool
		//remove user to whitelisted pool list
		//remove pool from user pools
	}

	function isWhitelisted(address pool, address member)
		public
		returns (bool isMemberWhitelisted)
	{
		//todo: true if both member and whitelisted
	}

	function isPoolMember(address pool, address member)
		public
		view
		returns (bool isMember, bool isMemberWhitelisted)
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
		address membersAdmin,
		IIdentity uniqueness,
		bool allowFoundationAdmin,
		bytes32 merkleDrop
	) public {
		require(msg.sender == pools[pool].creator, "not owner");
		//modify details and grant/revoke roles
	}

	// from StorJ -- https://github.com/nginnever/storj-audit-verifier/blob/master/contracts/MerkleVerifyv3.sol
	/**
	 * @dev non sorted merkle tree proof check
	 */
	function checkProofOrdered(
		bytes32[] memory _proof,
		bytes32 _root,
		bytes32 _hash,
		uint256 _index
	) public pure returns (bool) {
		// use the index to determine the node ordering
		// index ranges 1 to n

		bytes32 proofElement;
		bytes32 computedHash = _hash;
		uint256 remaining;

		for (uint256 j = 0; j < _proof.length; j++) {
			proofElement = _proof[j];

			// calculate remaining elements in proof
			remaining = _proof.length - j;

			// we don't assume that the tree is padded to a power of 2
			// if the index is odd then the proof will start with a hash at a higher
			// layer, so we have to adjust the index to be the index at that layer
			while (remaining > 0 && _index % 2 == 1 && _index > 2**remaining) {
				_index = _index / 2 + 1;
			}

			if (_index % 2 == 0) {
				computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
				_index = _index / 2;
			} else {
				computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
				_index = _index / 2 + 1;
			}
		}

		return computedHash == _root;
	}
}
