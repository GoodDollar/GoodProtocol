// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./DAOContract.sol";

/**
@title Simple contract that adds upgradability to DAOContract
*/

contract DAOUpgradableContract is UUPSUpgradeable, DAOContract {
	function _authorizeUpgrade(address) internal override {
		_onlyAvatar();
	}
}
