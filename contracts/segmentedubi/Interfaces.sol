// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../Interfaces.sol";

interface IMembersValidator {
	function isValid(
		address pool,
		address member,
		bytes32 identifier,
		bytes memory extraData,
		bool isIdentifierWhitelisted
	) external view returns (bool valid);
}

struct UBIPoolSettings {
	INameService ns;
	address owner;
	uint256 claimPeriod;
	uint256 maxInactiveDays;
	uint256 dailyCap;
	bool isFixedAmount;
	bool isDAOOwned;
	bool canWithdrawFunds;
}
