// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../Interfaces.sol";
import "../utils/NameService.sol";
import "./AdminWallet.sol";

/* @title Admin wallet contract allowing whitelisting and topping up of
 * addresses
 */
contract BulkWhitelist {
	AdminWallet adminWallet;

	constructor(AdminWallet _adminWallet) {
		adminWallet = _adminWallet;
	}

	modifier onlyAdmin() {
		require(adminWallet.isAdmin(msg.sender), "not admin");
		_;
	}

	receive() external payable {}

	function whitelist(
		address[] memory _user,
		string[] memory _did,
		uint256[] memory orgChain,
		uint256[] memory dateAuthenticated
	) external onlyAdmin {
		for (uint i = 0; i < _user.length; i++) {
			adminWallet.whitelist(
				_user[i],
				_did[i],
				orgChain[i],
				dateAuthenticated[i]
			);
		}
		uint256 toTop = address(this).balance;
		payable(address(msg.sender)).transfer(toTop);
	}

	function removeWhitelisted(address[] memory _user) external onlyAdmin {
		for (uint i = 0; i < _user.length; i++) {
			adminWallet.removeWhitelist(_user[i]);
		}

		uint256 toTop = address(this).balance;
		payable(address(msg.sender)).transfer(toTop);
	}
}
