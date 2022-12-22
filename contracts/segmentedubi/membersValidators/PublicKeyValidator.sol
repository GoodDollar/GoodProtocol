// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../Interfaces.sol";

contract PublicKeyValidator is IMembersValidator {
	function isValid(
		address,
		address member,
		bytes32 identifier,
		bytes memory extraData,
		bool isIdentifierWhitelisted
	) external view override returns (bool valid) {
		if (isIdentifierWhitelisted == false) return false;

		(uint256 validUntil, bytes memory sig) = abi.decode(
			extraData,
			(uint256, bytes)
		);
		if (validUntil < block.timestamp) return false;
		bytes32 digest = keccak256(abi.encode(member, validUntil));
		bytes32 hash = ECDSA.toEthSignedMessageHash(digest);
		(address signer, ) = ECDSA.tryRecover(hash, sig);
		valid = signer == address(uint160(uint256(identifier)));
	}
}
