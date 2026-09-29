// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import { ISuperfluid } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { ISuperfluidToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluidToken.sol";

/// @title stream pause guard for SuperGoodDollar
/// @notice externally linked library, so its bytecode is kept out of SuperGoodDollar.
/// Called by delegatecall: msg.sender is the agreement class calling the token and
/// address(this) is the token itself.
library SuperGoodDollarFlows {
	error SUPER_GOODDOLLAR_PAUSED();

	bytes32 private constant CFA_V1_TYPE =
		keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");

	/// while paused, block opening or increasing a stream. Closing, decreasing and
	/// liquidating are deliberately left open: during an incident we still need to be
	/// able to shut malicious streams down.
	/// The CFA writes all flow state through updateAgreementData (create, update and
	/// delete alike), and writes its flow operator (ACL) data through it as well, so
	/// the guard is limited to the CFA and to the flow data layout.
	/// CFA flow data packing:
	/// | timestamp 32 | flowRate 96 | deposit 64 | owedDeposit 64 |
	/// the timestamp is non zero only when flowRate > 0, and is always zero in the
	/// flow operator (ACL) data the CFA writes through the same function, so it
	/// discriminates between the two single word layouts.
	function onlyNotIncreasingFlow(
		ISuperfluid host,
		bytes32 id,
		bytes32[] calldata data
	) external view {
		// the agreement class is looked up on the host on each paused call, so that a
		// superfluid governance change of the CFA registration is picked up
		if (msg.sender != address(host.getAgreementClass(CFA_V1_TYPE))) return;
		uint256 newWord = uint256(data[0]);
		// a zero timestamp means a flow being closed, or flow operator data
		if (newWord >> 224 == 0) return;
		// the previous flow data, zeros for a new flow
		uint256 oldWord = uint256(
			ISuperfluidToken(address(this)).getAgreementData(msg.sender, id, 1)[0]
		);
		if (_flowRate(newWord) > _flowRate(oldWord)) {
			revert SUPER_GOODDOLLAR_PAUSED();
		}
	}

	/// mirrors ConstantFlowAgreementV1._decodeFlowData, which is internal to the CFA
	function _flowRate(uint256 word) private pure returns (int96) {
		return int96(int256(word >> 128) & int256(uint256(type(uint96).max)));
	}
}
