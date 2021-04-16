pragma solidity >=0.7.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../DAOStackInterfaces.sol";

/**
@title Simple contract that adds onlyAvatar modifier
*/

contract DAOContract {
	Controller public dao;

	Avatar public avatar;
	modifier onlyAvatar() {
		require(
			address(dao.avatar()) == msg.sender,
			"only avatar can call this method"
		);
		_;
	}

	function setDAO(Controller _dao) internal {
		dao = _dao;
		updateAvatar();
	}

	function updateAvatar() public {
		avatar = dao.avatar();
	}
}
