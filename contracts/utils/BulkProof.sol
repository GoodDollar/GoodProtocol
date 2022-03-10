// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import "../governance/GReputation.sol";

contract BulkProof {
	struct Proof {
		uint256 index;
		uint256 balance;
		address account;
		bytes32[] proof;
	}

	function bulkProof(Proof[] calldata proofs) external {
		for (uint256 i = 0; i < proofs.length; i++) {
			Proof memory proof = proofs[i];
			GReputation(0x603B8C0F110E037b51A381CBCacAbb8d6c6E4543)
				.proveBalanceOfAtBlockchain(
					"rootState",
					proof.account,
					proof.balance,
					proof.proof,
					proof.index
				);
		}
	}
}
