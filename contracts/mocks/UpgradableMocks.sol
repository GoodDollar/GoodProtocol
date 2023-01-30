// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "../utils/DAOUpgradeableContract.sol";

contract UpgradableMock is DAOUpgradeableContract {
	address public owner;

	function decimals() public pure returns (uint256) {
		return 8;
	}

	function initialize(address _owner) public initializer {
		owner = _owner;
	}

	function _authorizeUpgrade(address) internal virtual override {}
}

contract UpgradableMock2 is DAOUpgradeableContract {
	function decimals() public pure returns (uint256) {
		return 18;
	}

	function _authorizeUpgrade(address) internal virtual override {
		require(
			msg.sender == address(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266),
			"not authorized to upgrade"
		);
	}
}

contract UpgradableMock3 is DAOUpgradeableContract {
	function decimals() public pure returns (uint256) {
		return 3;
	}

	function initialize(INameService _ns) public initializer {
		setDAO(_ns);
	}
}

contract UpgradableMock4 is DAOUpgradeableContract {
	function decimals() public pure returns (uint256) {
		return 4;
	}

	function initialize(INameService _ns) public initializer {
		setDAO(_ns);
	}
}
