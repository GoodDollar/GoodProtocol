// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../DAOStackInterfaces.sol";
import "./NameService.sol";
import "../Interfaces.sol";

/**
@title Simple contract that adds onlyAvatar modifier
*/

contract DAOContract {
	Controller public dao;

	address public avatar;

	NameService public nameService;

	function _onlyAvatar() internal view {
		require(
			address(dao.avatar()) == msg.sender,
			"only avatar can call this method"
		);
	}

	function setDAO(NameService _ns) internal {
		nameService = _ns;
		updateAvatar();
	}

	function updateAvatar() public {
		dao = Controller(nameService.getAddress("CONTROLLER"));
		avatar = dao.avatar();
	}

	function nativeToken() public view returns (IGoodDollar) {
		return IGoodDollar(nameService.addresses(nameService.GOODDOLLAR()));
	}

	uint256[50] private gap;
}
