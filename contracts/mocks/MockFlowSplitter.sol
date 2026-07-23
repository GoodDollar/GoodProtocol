// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "../governance/IFlowSplitter.sol";

contract MockSuperfluidPool {
	string public name;
	string public symbol;
	mapping(address => uint128) public memberUnits;

	constructor(string memory _name, string memory _symbol) {
		name = _name;
		symbol = _symbol;
	}

	function updateMemberUnits(address member, uint128 units) external {
		memberUnits[member] = units;
	}
}

contract MockFlowSplitter is IFlowSplitter {
	uint256 public poolCounter;

	mapping(uint256 => Pool) private _poolsById;
	mapping(bytes32 => Pool) private _poolsByAdminRole;
	mapping(uint256 => mapping(address => bool)) private _poolAdmins;
	mapping(uint256 => address[]) private _poolAdminList;
	mapping(uint256 => MockSuperfluidPool) private _poolContracts;

	modifier onlyPoolAdmin(uint256 poolId) {
		if (!_poolAdmins[poolId][msg.sender]) {
			revert NOT_POOL_ADMIN();
		}
		_;
	}

	function createPool(
		ISuperToken _poolSuperToken,
		PoolConfig memory,
		PoolERC20Metadata memory _erc20Metadata,
		Member[] memory _members,
		address[] memory _admins,
		string memory _metadata
	) external returns (ISuperfluidPool gdaPool) {
		poolCounter++;
		bytes32 adminRole = keccak256(abi.encodePacked(poolCounter, "admin"));
		MockSuperfluidPool pool = new MockSuperfluidPool(
			_erc20Metadata.name,
			_erc20Metadata.symbol
		);

		_poolsById[poolCounter] = Pool({
			id: poolCounter,
			poolAddress: address(pool),
			token: address(_poolSuperToken),
			metadata: _metadata,
			adminRole: adminRole
		});
		_poolsByAdminRole[adminRole] = _poolsById[poolCounter];
		_poolContracts[poolCounter] = pool;

		for (uint256 i = 0; i < _admins.length; i++) {
			_poolAdmins[poolCounter][_admins[i]] = true;
			_poolAdminList[poolCounter].push(_admins[i]);
		}

		_updateMembers(poolCounter, _members);

		emit PoolCreated(
			poolCounter,
			address(pool),
			address(_poolSuperToken),
			_metadata
		);

		return ISuperfluidPool(address(pool));
	}

	function addPoolAdmin(uint256 poolId, address admin)
		external
		onlyPoolAdmin(poolId)
	{
		if (admin == address(0)) revert ZERO_ADDRESS();
		_poolAdmins[poolId][admin] = true;
		_poolAdminList[poolId].push(admin);
	}

	function removePoolAdmin(uint256 poolId, address admin)
		external
		onlyPoolAdmin(poolId)
	{
		_poolAdmins[poolId][admin] = false;
	}

	function updatePoolAdmins(uint256 poolId, Admin[] memory admins)
		external
		onlyPoolAdmin(poolId)
	{
		for (uint256 i = 0; i < admins.length; i++) {
			if (admins[i].status == AdminStatus.Added) {
				_poolAdmins[poolId][admins[i].account] = true;
				_poolAdminList[poolId].push(admins[i].account);
			} else {
				_poolAdmins[poolId][admins[i].account] = false;
			}
		}
	}

	function updateMembersUnits(uint256 poolId, Member[] memory members)
		external
		onlyPoolAdmin(poolId)
	{
		_updateMembers(poolId, members);
	}

	function updatePoolMetadata(uint256 poolId, string memory metadata)
		external
		onlyPoolAdmin(poolId)
	{
		_poolsById[poolId].metadata = metadata;
		emit PoolMetadataUpdated(poolId, metadata);
	}

	function isPoolAdmin(uint256 poolId, address account)
		external
		view
		returns (bool)
	{
		return _poolAdmins[poolId][account];
	}

	function getPoolById(uint256 poolId) external view returns (Pool memory pool) {
		return _poolsById[poolId];
	}

	function getPoolByAdminRole(bytes32 adminRole)
		external
		view
		returns (Pool memory pool)
	{
		return _poolsByAdminRole[adminRole];
	}

	function getPoolNameById(uint256 poolId)
		external
		view
		returns (string memory name)
	{
		return _poolContracts[poolId].name();
	}

	function getPoolSymbolById(uint256 poolId)
		external
		view
		returns (string memory symbol)
	{
		return _poolContracts[poolId].symbol();
	}

	function getMemberUnits(uint256 poolId, address account)
		external
		view
		returns (uint128)
	{
		return _poolContracts[poolId].memberUnits(account);
	}

	function _updateMembers(uint256 poolId, Member[] memory members) internal {
		for (uint256 i = 0; i < members.length; i++) {
			_poolContracts[poolId].updateMemberUnits(
				members[i].account,
				members[i].units
			);
		}
	}
}
