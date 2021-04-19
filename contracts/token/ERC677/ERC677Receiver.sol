// SPDX-License-Identifier: MIT

pragma solidity >=0.7;

abstract contract ERC677Receiver {
	function onTokenTransfer(
		address _from,
		uint256 _value,
		bytes memory _data
	) external virtual returns (bool);
}
