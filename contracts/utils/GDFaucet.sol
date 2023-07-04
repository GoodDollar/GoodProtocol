// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "./DAOContract.sol";

contract GDFaucet is DAOContract {
	uint256 public dripAmount;
	mapping(address => uint256) public lastDripTime;

	constructor(INameService _dao, uint256 _dripAmount) {
		setDAO(_dao);
		dripAmount = _dripAmount;
	}

	function drip() external {
		require(
			block.timestamp - lastDripTime[msg.sender] >= 24 hours,
			"drip limit"
		);
		lastDripTime[msg.sender] = block.timestamp;
		uint decimals = nativeToken().decimals();
		require(
			dao.mintTokens(dripAmount * (10 ** decimals), msg.sender, dao.avatar()),
			"mint failed"
		);
	}
}
