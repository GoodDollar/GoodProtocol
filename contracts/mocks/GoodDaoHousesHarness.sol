// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "../governance/GoodDaoHouses.sol";

/// @dev Test-only harness that exposes a setter for voteRecipientWeightedVotes.
///      Never deploy this contract in production.
contract GoodDaoHousesHarness is GoodDaoHouses {
	/// @notice Overwrite a recipient's accumulated vote weight for a given voteId.
	///         Callable only by the governance committee; used in tests to inject
	///         values that cannot be reached via normal voting (e.g. > type(uint128).max).
	function setVoteWeightForTest(
		uint256 voteId,
		address recipient,
		uint256 amount
	) external onlyRole(GOVERNANCE_COMMITTEE_ROLE) {
		voteRecipientWeightedVotes[voteId][recipient] = amount;
	}
}
