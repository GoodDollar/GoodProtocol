// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import "../Interfaces.sol";

contract IdentityMock is IIdentity {
	address public immutable owner;
	address public immutable daoContract;

	constructor(address daoContract_) {
		owner = msg.sender;
		daoContract = daoContract_;
	}

	function isWhitelisted(address user) external view returns (bool) {
		return true;
	}

	function addWhitelistedWithDID(address account, string memory did) external {}

	function removeWhitelisted(address account) external {}

	function addBlacklisted(address account) external {}

	function removeBlacklisted(address account) external {}

	function isBlacklisted(address user) external view returns (bool) {
		return true;
	}

	function addIdentityAdmin(address account) external returns (bool) {
		return true;
	}

	function setAvatar(address _avatar) external {}

	function isIdentityAdmin(address account) external view returns (bool) {
		return true;
	}

	// provided by the immutable "owner"
	//function owner() external view returns (address);

	function removeContract(address account) external {}

	function isDAOContract(address account) external view returns (bool) {
		return false;
	}

	function addrToDID(address account) external view returns (string memory) {
		return "not implemented";
	}

	function didHashToAddress(bytes32 hash) external view returns (address) {
		return address(0); // not implemented
	}

	function lastAuthenticated(address account) external view returns (uint256) {
		return 0;
	}
}
