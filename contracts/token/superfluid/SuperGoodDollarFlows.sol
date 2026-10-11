// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import { ISuperfluid } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { ISuperfluidToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluidToken.sol";

/// @title agreement guards for SuperGoodDollar (pause, blocklist)
/// @notice externally linked library, so its bytecode is kept out of SuperGoodDollar.
/// Called by delegatecall: msg.sender is the agreement class calling the token and
/// address(this) is the token itself.
/// The agreement classes are looked up on the host on each guarded call, so that a
/// superfluid governance change of their registration is picked up.
/// Closing, decreasing and liquidating flows are deliberately left open: during an
/// incident we still need to be able to shut malicious streams down.
library SuperGoodDollarFlows {
	error SUPER_GOODDOLLAR_PAUSED();
	error SUPER_GOODDOLLAR_BLOCKED();

	bytes32 private constant CFA_V1_TYPE =
		keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
	bytes32 private constant IDA_V1_TYPE =
		keccak256("org.superfluid-finance.agreements.InstantDistributionAgreement.v1");
	bytes32 private constant GDA_V1_TYPE =
		keccak256("org.superfluid-finance.agreements.GeneralDistributionAgreement.v1");

	/// while paused, block any IDA write, and opening or increasing a CFA stream.
	/// The IDA writes its index and subscription data through updateAgreementData on
	/// every value movement (distribute, claim, (un)subscribe).
	/// The CFA writes all flow state through updateAgreementData (create, update and
	/// delete alike), and writes its flow operator (ACL) data through it as well.
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
		if (_isAgreement(host, IDA_V1_TYPE)) revert SUPER_GOODDOLLAR_PAUSED();
		if (!_isAgreement(host, CFA_V1_TYPE)) return;
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

	/// while paused, or for a blocked account, block the account state writes that move
	/// value out of the account:
	/// - IDA: any write (publisher deposit, subscription bitmaps)
	/// - CFA: a deposit increase, ie. opening or increasing an outgoing stream
	/// - GDA: a buffer increase (opening or increasing a pool distribution flow), or a
	///   drop of the account balance (instant distribution, a pool paying claims)
	/// The CFA and the GDA keep the account flow state in slot 0:
	/// CFA: | timestamp 32 | flowRate 96 | deposit 64 | owedDeposit 64 |
	/// GDA: | flowRate 96 | settledAt 32 | totalBuffer 96 | isPool 32 |, settledValue
	/// a single word GDA write (buffer, pool flag) keeps the settled value.
	/// The GDA is looked up last: on a host without one (no GDA registered) that lookup reverts.
	function onlyNotIncreasingOutflow(
		ISuperfluid host,
		bool paused,
		address account,
		uint256 slotId,
		bytes32[] calldata data
	) external view {
		if (_isAgreement(host, IDA_V1_TYPE)) _revert(paused);
		if (slotId != 0) return;
		if (_isAgreement(host, CFA_V1_TYPE)) {
			uint256 newWord = uint256(data[0]);
			uint256 oldWord = uint256(_accountState(account, 1)[0]);
			if (uint64(newWord >> 64) > uint64(oldWord >> 64)) _revert(paused);
		} else if (_isAgreement(host, GDA_V1_TYPE)) {
			uint256 newWord = uint256(data[0]);
			bytes32[] memory old = _accountState(account, 2);
			uint256 oldWord = uint256(old[0]);
			int256 oldValue = int256(uint256(old[1]));
			int256 newValue = data.length > 1 ? int256(uint256(data[1])) : oldValue;
			if (
				uint96(newWord >> 32) > uint96(oldWord >> 32) ||
				_balanceNow(newWord, newValue) < _balanceNow(oldWord, oldValue)
			) _revert(paused);
		}
	}

	/// a blocked account can not pay IDA distributions
	function onlyNotIDA(ISuperfluid host) external view {
		if (_isAgreement(host, IDA_V1_TYPE)) revert SUPER_GOODDOLLAR_BLOCKED();
	}

	function _isAgreement(
		ISuperfluid host,
		bytes32 agreementType
	) private view returns (bool) {
		return msg.sender == address(host.getAgreementClass(agreementType));
	}

	/// the account state of the calling agreement, in slot 0
	function _accountState(
		address account,
		uint256 length
	) private view returns (bytes32[] memory) {
		return
			ISuperfluidToken(address(this)).getAgreementStateSlot(
				msg.sender,
				account,
				0,
				length
			);
	}

	/// GDA account balance now: settledValue + flowRate * (now - settledAt)
	function _balanceNow(
		uint256 word,
		int256 settledValue
	) private view returns (int256) {
		return
			settledValue +
			int256(int96(uint96(word >> 160))) *
			int256(block.timestamp - uint32(word >> 128));
	}

	function _revert(bool paused) private pure {
		if (paused) revert SUPER_GOODDOLLAR_PAUSED();
		revert SUPER_GOODDOLLAR_BLOCKED();
	}

	/// mirrors ConstantFlowAgreementV1._decodeFlowData, which is internal to the CFA
	function _flowRate(uint256 word) private pure returns (int96) {
		return int96(int256(word >> 128) & int256(uint256(type(uint96).max)));
	}
}
