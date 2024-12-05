// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import "../Interfaces.sol";

interface IUpgradeabilityOwnerStorage {
	function upgradeabilityOwner() external view returns (address);
}

contract Upgradeable {
	// Avoid using onlyUpgradeabilityOwner name to prevent issues with implementation from proxy contract
	modifier onlyIfUpgradeabilityOwner() {
		require(
			msg.sender ==
				IUpgradeabilityOwnerStorage(address(this)).upgradeabilityOwner()
		);
		/* solcov ignore next */
		_;
	}
}

/**
 * @title EternalStorage
 * @dev This contract holds all the necessary state variables to carry out the storage of any contract.
 */
contract EternalStorage {
	mapping(bytes32 => uint256) internal uintStorage;
	mapping(bytes32 => string) internal stringStorage;
	mapping(bytes32 => address) internal addressStorage;
	mapping(bytes32 => bytes) internal bytesStorage;
	mapping(bytes32 => bool) internal boolStorage;
	mapping(bytes32 => int256) internal intStorage;
}

/**
 * @title Ownable
 * @dev This contract has an owner address providing basic authorization control
 */
contract Ownable is EternalStorage {
	bytes4 internal constant UPGRADEABILITY_OWNER = 0x6fde8202; // upgradeabilityOwner()

	/**
	 * @dev Event to show ownership has been transferred
	 * @param previousOwner representing the address of the previous owner
	 * @param newOwner representing the address of the new owner
	 */
	event OwnershipTransferred(address previousOwner, address newOwner);

	/**
	 * @dev Throws if called by any account other than the owner.
	 */
	modifier onlyOwner() {
		require(msg.sender == owner());
		/* solcov ignore next */
		_;
	}

	/**
	 * @dev Throws if called by any account other than contract itself or owner.
	 */
	modifier onlyRelevantSender() {
		// proxy owner if used through proxy, address(0) otherwise
		(bool ok, bytes memory addr) = address(this).call(
			abi.encodeWithSelector(UPGRADEABILITY_OWNER)
		);
		address upgowner = abi.decode(addr, (address));
		require(
			(ok && upgowner != address(0)) || // covers usage without calling through storage proxy
				msg.sender ==
				IUpgradeabilityOwnerStorage(address(this)).upgradeabilityOwner() || // covers usage through regular proxy calls
				msg.sender == address(this) // covers calls through upgradeAndCall proxy method
		);
		/* solcov ignore next */
		_;
	}

	bytes32 internal constant OWNER =
		0x02016836a56b71f0d02689e69e326f4f4c1b9057164ef592671cf0d37c8040c0; // keccak256(abi.encodePacked("owner"))

	/**
	 * @dev Tells the address of the owner
	 * @return the address of the owner
	 */
	function owner() public view returns (address) {
		return addressStorage[OWNER];
	}

	/**
	 * @dev Allows the current owner to transfer control of the contract to a newOwner.
	 * @param newOwner the address to transfer ownership to.
	 */
	function transferOwnership(address newOwner) external onlyOwner {
		require(newOwner != address(0));
		setOwner(newOwner);
	}

	/**
	 * @dev Sets a new owner address
	 */
	function setOwner(address newOwner) internal {
		emit OwnershipTransferred(owner(), newOwner);
		addressStorage[OWNER] = newOwner;
	}
}

contract Initializable is EternalStorage {
	bytes32 internal constant INITIALIZED =
		0x0a6f646cd611241d8073675e00d1a1ff700fbf1b53fcf473de56d1e6e4b714ba; // keccak256(abi.encodePacked("isInitialized"))

	function setInitialize() internal {
		boolStorage[INITIALIZED] = true;
	}

	function isInitialized() public view returns (bool) {
		return boolStorage[INITIALIZED];
	}
}

contract FuseOldBridgeKill is Initializable, Upgradeable {
	function end() external {
		IGoodDollar(0x495d133B938596C9984d462F007B676bDc57eCEC).renounceMinter();
	}
}
