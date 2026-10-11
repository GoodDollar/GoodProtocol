// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

/// test: ERC1820 implementer whose ERC777 tokensToSend always reverts
contract RevertingTokensSenderMock {
	bytes32 private constant _ACCEPT_MAGIC = keccak256("ERC1820_ACCEPT_MAGIC");

	function canImplementInterfaceForAddress(
		bytes32,
		address
	) external pure returns (bytes32) {
		return _ACCEPT_MAGIC;
	}

	function tokensToSend(
		address,
		address,
		address,
		uint256,
		bytes calldata,
		bytes calldata
	) external pure {
		revert("holder blocks burn");
	}
}
