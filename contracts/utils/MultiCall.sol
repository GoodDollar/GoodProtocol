/**
 *Submitted for verification at Etherscan.io on 2019-12-10
 */

pragma solidity >=0.5.0;
pragma experimental ABIEncoderV2;

/// @title Multicall - Aggregate results from multiple read-only function calls
/// @author Michael Elliot <mike@makerdao.com>
/// @author Joshua Levine <joshua@makerdao.com>
/// @author Nick Johnson <arachnid@notdot.net>
/// @author Bogdan Dumitru <bogdan@bowd.io>

contract Multicall {
	struct Call {
		address target;
		bytes callData;
	}
	struct Return {
		bool success;
		bytes data;
	}

	function aggregate(
		Call[] memory calls,
		bool strict
	) public returns (uint256 blockNumber, Return[] memory returnData) {
		blockNumber = block.number;
		returnData = new Return[](calls.length);
		for (uint256 i = 0; i < calls.length; i++) {
			(bool success, bytes memory ret) = calls[i].target.call(
				calls[i].callData
			);
			if (strict) {
				require(success);
			}
			returnData[i] = Return(success, ret);
		}
	}

	// Helper functions
	function getEthBalance(address addr) public view returns (uint256 balance) {
		balance = addr.balance;
	}

	function getBlockHash(
		uint256 blockNumber
	) public view returns (bytes32 blockHash) {
		blockHash = blockhash(blockNumber);
	}

	function getLastBlockHash() public view returns (bytes32 blockHash) {
		blockHash = blockhash(block.number - 1);
	}

	function getCurrentBlockTimestamp() public view returns (uint256 timestamp) {
		timestamp = block.timestamp;
	}

	function getCurrentBlockDifficulty()
		public
		view
		returns (uint256 difficulty)
	{
		difficulty = block.prevrandao;
	}

	function getCurrentBlockGasLimit() public view returns (uint256 gaslimit) {
		gaslimit = block.gaslimit;
	}

	function getCurrentBlockCoinbase() public view returns (address coinbase) {
		coinbase = block.coinbase;
	}
}
