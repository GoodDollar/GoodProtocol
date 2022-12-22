// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../utils/BeaconProxyImpl.sol";

import "./Interfaces.sol";
import "./SegmentedUBIFactory.sol";

contract SegmentedIdentity is DAOUpgradeableContract, AccessControlUpgradeable {
	struct PoolInfo {
		string description;
		IMembersValidator membersValidator;
		IIdentity uniqueIdentity;
		mapping(bytes32 => address) identifierToMember;
		mapping(address => bool) members;
		mapping(bytes32 => bool) identifiers;
		uint256 membersCount;
	}

	mapping(address => PoolInfo) public pools;
	mapping(address => address[]) public memberToPools;
	address foundationAdminWallet;

	modifier onlyMembersAdmin(address pool) {
		require(
			hasRole(keccak256(abi.encode("POOL_MEMBERS_ADMIN", pool)), msg.sender) ||
				hasRole(keccak256(abi.encode("POOL_MEMBERS_ADMIN", pool)), address(0)),
			"not pool members admin"
		);
		_;
	}

	modifier onlyIdentifiersAdmin(address pool) {
		require(
			hasRole(
				keccak256(abi.encode("POOL_IDENTIFIERS_ADMIN", pool)),
				msg.sender
			),
			"not pool identifiers admin"
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
		address owner,
		address membersAdmin,
		address identifiersAdmin,
		string memory description,
		bool allowFoundationAdmin,
		IIdentity uniqueness,
		IMembersValidator membersValidator,
		UBIPoolSettings memory settings
	) public {
		//function initialize(INameService _ns, address _owner, uint256 _claimPeriod, uint256 _maxInactiveDays, uint256 _dailyCap, bool _isFixedAmount, bool _isDAOOwned, bool _canWithdrawFunds)
		address pool = SegmentedUBIFactory(
			nameService.getAddress("SEGMENTEDUBI_FACTORY")
		).createPoolAndInitialize(
				owner,
				description,
				abi.encodeWithSignature(
					"initialize(address,address,uint256,uint256,uint256,bool,bool,bool)",
					settings
				)
			);

		PoolInfo storage poolInfo = pools[address(pool)];
		poolInfo.membersValidator = membersValidator;
		poolInfo.uniqueIdentity = uniqueness;
		poolInfo.description = description;

		_setupRole(keccak256(abi.encode("POOL_OWNER", pool)), owner);
		_setRoleAdmin(
			keccak256(abi.encode("POOL_OWNER", pool)),
			keccak256(abi.encode("POOL_OWNER", pool))
		);
		_setRoleAdmin(
			keccak256(abi.encode("POOL_MEMBERS_ADMIN", pool)),
			keccak256(abi.encode("POOL_OWNER", pool))
		);
		_setRoleAdmin(
			keccak256(abi.encode("POOL_IDENTIFIER_ADMIN", pool)),
			keccak256(abi.encode("POOL_OWNER", pool))
		);

		if (membersAdmin != address(0))
			_setupRole(
				keccak256(abi.encode("POOL_MEMBERS_ADMIN", pool)),
				membersAdmin
			);
		if (identifiersAdmin != address(0))
			_setupRole(
				keccak256(abi.encode("POOL_IDENTIFIERS_ADMIN", pool)),
				identifiersAdmin
			);

		if (membersAdmin != address(0))
			_setupRole(
				keccak256(abi.encode("POOL_MEMBERS_ADMIN", pool)),
				foundationAdminWallet
			);
	}

	function whitelistIdentifier(address pool, bytes32 identifier)
		external
		onlyIdentifiersAdmin(pool)
	{
		pools[pool].identifiers[identifier] = true;
	}

	function blacklistIdentifier(address pool, bytes32 identifier)
		external
		onlyIdentifiersAdmin(pool)
	{
		pools[pool].identifiers[identifier] = false;
	}

	/**
		@dev connect a member to identifier making him a valid member of the pool
		@param extraData any extra data to pass to the identifiers validator. usually would be proof of identifier ownership
	 */
	function whitelistMember(
		address pool,
		address member,
		bytes32 identifier,
		bytes memory extraData
	) public onlyMembersAdmin(pool) {
		_whitelistMember(pool, member, identifier, extraData);
	}

	function _whitelistMember(
		address pool,
		address member,
		bytes32 identifier,
		bytes memory extraData
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
		IMembersValidator membersValidator = pools[pool].membersValidator;
		if (address(membersValidator) != address(0)) {
			require(
				membersValidator.isValid(
					pool,
					member,
					identifier,
					extraData,
					pools[pool].identifiers[identifier]
				),
				"invalid member identifier"
			);
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
