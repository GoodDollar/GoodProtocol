// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

/* @title ERC677Receiver interface
 */
interface ERC677Receiver {
	function onTokenTransfer(
		address _from,
		uint256 _value,
		bytes calldata _data
	) external returns (bool);
}

abstract contract ERC677 {
	event Transfer(
		address indexed from,
		address indexed to,
		uint256 value,
		bytes data
	);

	function transfer(address to, uint256 value) public virtual returns (bool);

	/**
	 * @dev transfer token to a contract address with additional data if the recipient is a contact.
	 * @param _to The address to transfer to.
	 * @param _value The amount to be transferred.
	 * @param _data The extra data to be passed to the receiving contract.
	 * @return true if transfer is successful
	 */
	function _transferAndCall(
		address _to,
		uint256 _value,
		bytes memory _data
	) internal returns (bool) {
		bool res = transfer(_to, _value);
		emit Transfer(msg.sender, _to, _value, _data);

		if (isContract(_to)) {
			require(contractFallback(_to, _value, _data), "Contract fallback failed");
		}
		return res;
	}

	/* @dev Contract fallback function. Is called if transferAndCall is called
	 * to a contract
	 */
	function contractFallback(
		address _to,
		uint256 _value,
		bytes memory _data
	) internal virtual returns (bool) {
		ERC677Receiver receiver = ERC677Receiver(_to);
		require(
			receiver.onTokenTransfer(msg.sender, _value, _data),
			"Contract Fallback failed"
		);
		return true;
	}

	/* @dev Function to check if given address is a contract
	 * @param _addr Address to check
	 * @return true if given address is a contract
	 */

	function isContract(address _addr) internal view returns (bool) {
		uint256 length;
		assembly {
			length := extcodesize(_addr)
		}
		return length > 0;
	}
}
