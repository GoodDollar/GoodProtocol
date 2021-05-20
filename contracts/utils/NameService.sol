// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../DAOStackInterfaces.sol";

/**
@title Simple name to address resolver
*/

contract NameService is Initializable {
	bytes32 public constant FUND_MANAGER = keccak256("FUND_MANAGER");
	bytes32 public constant RESERVE = keccak256("RESERVE");
	bytes32 public constant MARKET_MAKER = keccak256("MARKET_MAKER");
	bytes32 public constant CONTROLLER = keccak256("CONTROLLER");
	bytes32 public constant AVATAR = keccak256("AVATAR");
	bytes32 public constant IDENTITY = keccak256("IDENTITY");
	bytes32 public constant GOODDOLLAR = keccak256("GOODDOLLAR");
	bytes32 public constant REPUTATION = keccak256("REPUTATION");
	bytes32 public constant GDAO_STAKING = keccak256("GDAO_STAKING"); //staking G$ for GDAO contract on fuse
	bytes32 public constant GDAO_CLAIMERS = keccak256("GDAO_CLAIMERS"); //gdao distribution to claimers on fuse
	bytes32 public constant GDAO_STAKERS = keccak256("GDAO_STAKERS"); //gdao distribution to stakers on mainnet
	bytes32 public constant UBISCHEME = keccak256("UBISCHEME");
	bytes32 public constant BRIDGE_CONTRACT = keccak256("BRIDGE_CONTRACT");
	bytes32 public constant UBI_RECIPIENT = keccak256("UBI_RECIPIENT"); //usually same as UBISCHEME

	mapping(bytes32 => address) public addresses;

	Controller public dao;

	function initialize(
		Controller _dao,
		bytes32[] memory _nameHashes,
		address[] memory _addresses
	) public virtual initializer {
		dao = _dao;
		for (uint256 i = 0; i < _nameHashes.length; i++) {
			addresses[_nameHashes[i]] = _addresses[i];
		}
		addresses[CONTROLLER] = address(_dao);
		addresses[AVATAR] = address(_dao.avatar());
	}

	function setAddress(string memory name, address addr) external {
		require(
			address(dao.avatar()) == msg.sender,
			"only avatar can call this method"
		);
		addresses[keccak256(bytes(name))] = addr;
	}

	function setAddresses(bytes32[] calldata hash, address[] calldata addrs)
		external
	{
		require(
			address(dao.avatar()) == msg.sender,
			"only avatar can call this method"
		);
		for (uint256 i = 0; i < hash.length; i++) {
			addresses[hash[i]] = addrs[i];
		}
	}

	function getAddress(string memory name) external view returns (address) {
		return addresses[keccak256(bytes(name))];
	}
}
