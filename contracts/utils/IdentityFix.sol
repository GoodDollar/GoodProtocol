// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../identity/IdentityV2.sol";

contract IdentityFix {
	IdentityV2 public identity;

	constructor(IdentityV2 _identity) {
		identity = _identity;
	}

	function fix(address[] memory addrs, uint256[] memory timestamps) public {
		require(
			identity.hasRole(identity.IDENTITY_ADMIN_ROLE(), msg.sender),
			"not admin"
		);
		for (uint256 i = 0; i < addrs.length; i++) {
			identity.authenticateWithTimestamp(addrs[i], timestamps[i]);
		}
	}

	function end() public {
		require(
			identity.hasRole(identity.IDENTITY_ADMIN_ROLE(), msg.sender),
			"not admin"
		);
		identity.renounceRole(identity.IDENTITY_ADMIN_ROLE(), address(this));
		selfdestruct(payable(msg.sender));
	}
}
