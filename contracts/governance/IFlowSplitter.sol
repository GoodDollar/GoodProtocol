// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

interface ISuperToken {}

interface ISuperfluidPool {
	function updateMemberUnits(address member, uint128 units) external;

	function name() external view returns (string memory);

	function symbol() external view returns (string memory);
}

struct PoolConfig {
	bool transferabilityForUnitsOwner;
	bool distributionFromAnyAddress;
}

struct PoolERC20Metadata {
	string name;
	string symbol;
	uint8 decimals;
}

/// @title FlowSplitter Interface
/// @notice Interface for the Flow Splitter contract.
interface IFlowSplitter {
	struct Pool {
		uint256 id;
		address poolAddress;
		address token;
		string metadata;
		bytes32 adminRole;
	}

	struct Member {
		address account;
		uint128 units;
	}

	struct Admin {
		address account;
		AdminStatus status;
	}

	enum AdminStatus {
		Added,
		Removed
	}

	event PoolCreated(
		uint256 indexed poolId,
		address poolAddress,
		address token,
		string metadata
	);
	event PoolMetadataUpdated(uint256 indexed poolId, string metadata);

	error NOT_POOL_ADMIN();
	error ZERO_ADDRESS();

	function createPool(
		ISuperToken _poolSuperToken,
		PoolConfig memory _poolConfig,
		PoolERC20Metadata memory _erc20Metadata,
		Member[] memory _members,
		address[] memory _admins,
		string memory _metadata
	) external returns (ISuperfluidPool gdaPool);

	function addPoolAdmin(uint256 poolId, address admin) external;

	function removePoolAdmin(uint256 poolId, address admin) external;

	function updatePoolAdmins(uint256 poolId, Admin[] memory admins) external;

	function updateMembersUnits(uint256 poolId, Member[] memory members) external;

	function updatePoolMetadata(uint256 poolId, string memory metadata) external;

	function isPoolAdmin(uint256 poolId, address account)
		external
		view
		returns (bool);

	function getPoolById(uint256 poolId) external view returns (Pool memory pool);

	function getPoolByAdminRole(bytes32 adminRole)
		external
		view
		returns (Pool memory pool);

	function getPoolNameById(uint256 _poolId)
		external
		view
		returns (string memory name);

	function getPoolSymbolById(uint256 _poolId)
		external
		view
		returns (string memory symbol);
}
