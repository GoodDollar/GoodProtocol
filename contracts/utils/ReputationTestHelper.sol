// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;

import "../governance/Reputation.sol";

contract ReputationTestHelper {
	Reputation public reputation;

	constructor(Reputation _reputation) {
		reputation = _reputation;
	}

	function multipleMint(
		address _user,
		uint256 _amount,
		uint256 _numberOfMint
	) public {
		uint256 i;
		for (i = 0; i < _numberOfMint; i++) {
			reputation.mint(_user, _amount);
		}
	}

	function multipleBurn(
		address _user,
		uint256 _amount,
		uint256 _numberOfBurn
	) public {
		uint256 i;
		for (i = 0; i < _numberOfBurn; i++) {
			reputation.burn(_user, _amount);
		}
	}
}
