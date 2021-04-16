pragma solidity >=0.7.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../utils/DAOContract.sol";

/**
@title Simple name to address resolver
*/

contract NameService is Initializable, DAOContract {
	mapping(bytes32 => address) public addresses;

	function initialize(
		Controller _dao,
		bytes32[] memory _nameHashes,
		address[] memory _addresses
	) public virtual initializer {
		setDAO(_dao);
		for (uint256 i = 0; i < _nameHashes.length; i++) {
			addresses[_nameHashes[i]] = _addresses[i];
		}
	}

	function setAddress(string memory name, address addr) public onlyAvatar {
		addresses[keccak256(bytes(name))] = addr;
	}

	function getAddress(string memory name) public view returns (address) {
		return addresses[keccak256(bytes(name))];
	}
}
