// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";

import "../DAOStackInterfaces.sol";
import "../utils/DAOContract.sol";

contract CompoundVotingMachine is
	Initializable,
	ContextUpgradeable,
	DAOContract
{
	/// @notice The name of this contract
	string public constant name = "GoodDAO Voting Machine";

	/// @notice timestamp when foundation releases guardian veto rights
	uint64 public foundationGuardianRelease;

	/// @notice the number of blocks a proposal is open for voting (before passing quorum)
	uint256 public votingPeriodBlocks;

	/// @notice The number of votes in support of a proposal required in order for a quorum to be reached and for a vote to succeed
	function quorumVotes() public view returns (uint256) {
		return (rep.totalSupply() * 3) / 100;
	} //3%

	/// @notice The number of votes required in order for a voter to become a proposer
	function proposalThreshold(uint256 blockNumber)
		public
		view
		returns (uint256)
	{
		return (rep.totalSupplyAt(blockNumber) * 1) / 100; //1%
	}

	/// @notice The maximum number of actions that can be included in a proposal
	function proposalMaxOperations() public pure returns (uint256) {
		return 10;
	} // 10 actions

	/// @notice The delay before voting on a proposal may take place, once proposed
	function votingDelay() public pure returns (uint256) {
		return 1;
	} // 1 block

	/// @notice The duration of voting on a proposal, in blocks
	function votingPeriod() public view returns (uint256) {
		return votingPeriodBlocks;
	} // ~14 days in blocks (assuming 15s blocks)

	/// @notice The duration of time after proposal passed thershold before it can be expected
	function queuePeriod() public pure returns (uint256) {
		return 2 days;
	} // 2 days

	/// @notice During the queue period if vote decision has changed, we extend queue period so
	/// that at least gameChangerPeriod is left
	function gameChangerPeriod() public pure returns (uint256) {
		return 1 days;
	} // 1 day

	/// @notice the time a succeeded proposal has to be executed on the blockchain
	function gracePeriod() public pure returns (uint256) {
		return 3 days;
	} //3 days

	/// @notice The address of the DAO reputation token
	ReputationInterface public rep;

	/// @notice The address of the Governor Guardian
	address public guardian;

	/// @notice The total number of proposals
	uint256 public proposalCount;

	struct Proposal {
		// Unique id for looking up a proposal
		uint256 id;
		// Creator of the proposal
		address proposer;
		// The timestamp that the proposal will be available for execution, set once the vote succeeds
		uint256 eta;
		// the ordered list of target addresses for calls to be made
		address[] targets;
		// The ordered list of values (i.e. msg.value) to be passed to the calls to be made
		uint256[] values;
		// The ordered list of function signatures to be called
		string[] signatures;
		// The ordered list of calldata to be passed to each call
		bytes[] calldatas;
		// The block at which voting begins: holders must delegate their votes prior to this block
		uint256 startBlock;
		// The block at which voting ends: votes must be cast prior to this block
		uint256 endBlock;
		// Current number of votes in favor of this proposal
		uint256 forVotes;
		// Current number of votes in opposition to this proposal
		uint256 againstVotes;
		// Flag marking whether the proposal has been canceled
		bool canceled;
		// Flag marking whether the proposal has been executed
		bool executed;
		// Receipts of ballots for the entire set of voters
		mapping(address => Receipt) receipts;
		// quorom required at time of proposing
		uint256 quoromRequired;
	}

	/// @notice Ballot receipt record for a voter
	struct Receipt {
		//Whether or not a vote has been cast
		bool hasVoted;
		// Whether or not the voter supports the proposal
		bool support;
		// The number of votes the voter had, which were cast
		uint256 votes;
	}

	/// @notice Possible states that a proposal may be in
	enum ProposalState {
		Pending,
		Active,
		ActiveTimelock, // passed quorom, time lock of 2 days activated, still open for voting
		Canceled,
		Defeated,
		Succeeded,
		// Queued, we dont have queued status, we use game changer period instead
		Expired,
		Executed
	}

	/// @notice The official record of all proposals ever proposed
	mapping(uint256 => Proposal) public proposals;

	/// @notice The latest proposal for each proposer
	mapping(address => uint256) public latestProposalIds;

	/// @notice The EIP-712 typehash for the contract's domain
	bytes32 public constant DOMAIN_TYPEHASH =
		keccak256(
			"EIP712Domain(string name,uint256 chainId,address verifyingContract)"
		);

	/// @notice The EIP-712 typehash for the ballot struct used by the contract
	bytes32 public constant BALLOT_TYPEHASH =
		keccak256("Ballot(uint256 proposalId,bool support)");

	/// @notice An event emitted when a new proposal is created
	event ProposalCreated(
		uint256 id,
		address proposer,
		address[] targets,
		uint256[] values,
		string[] signatures,
		bytes[] calldatas,
		uint256 startBlock,
		uint256 endBlock,
		string description
	);

	/// @notice An event emitted when a vote has been cast on a proposal
	event VoteCast(
		address voter,
		uint256 proposalId,
		bool support,
		uint256 votes
	);

	/// @notice An event emitted when a proposal has been canceled
	event ProposalCanceled(uint256 id);

	/// @notice An event emitted when a proposal has been queued
	event ProposalQueued(uint256 id, uint256 eta);

	/// @notice An event emitted when a proposal has been executed
	event ProposalExecuted(uint256 id);

	function initialize(
		NameService ns_, // the DAO avatar
		uint256 votingPeriodBlocks_ //number of blocks a proposal is open for voting before expiring
	) public initializer {
		foundationGuardianRelease = 1672531200; //01/01/2023
		setDAO(ns_);
		rep = ReputationInterface(ns_.addresses(ns_.REPUTATION()));
		votingPeriodBlocks = votingPeriodBlocks_;
		guardian = _msgSender();
	}

	/// @notice make a proposal to be voted on
	/// @param targets list of contracts to be excuted on
	/// @param values list of eth value to be used in each contract call
	/// @param signatures the list of functions to execute
	/// @param calldatas the list of parameters to pass to each function
	/// @return uint256 proposal id
	function propose(
		address[] memory targets,
		uint256[] memory values,
		string[] memory signatures,
		bytes[] memory calldatas,
		string memory description
	) public returns (uint256) {
		require(
			rep.getVotesAt(_msgSender(), true, block.number - 1) >
				proposalThreshold(block.number - 1),
			"CompoundVotingMachine::propose: proposer votes below proposal threshold"
		);
		require(
			targets.length == values.length &&
				targets.length == signatures.length &&
				targets.length == calldatas.length,
			"CompoundVotingMachine::propose: proposal function information arity mismatch"
		);
		require(
			targets.length != 0,
			"CompoundVotingMachine::propose: must provide actions"
		);
		require(
			targets.length <= proposalMaxOperations(),
			"CompoundVotingMachine::propose: too many actions"
		);

		uint256 latestProposalId = latestProposalIds[_msgSender()];

		if (latestProposalId != 0) {
			ProposalState proposersLatestProposalState =
				state(latestProposalId);
			require(
				proposersLatestProposalState != ProposalState.Active &&
					proposersLatestProposalState !=
					ProposalState.ActiveTimelock,
				"CompoundVotingMachine::propose: one live proposal per proposer, found an already active proposal"
			);
			require(
				proposersLatestProposalState != ProposalState.Pending,
				"CompoundVotingMachine::propose: one live proposal per proposer, found an already pending proposal"
			);
		}

		uint256 startBlock = block.number + votingDelay();
		uint256 endBlock = startBlock + votingPeriod();

		proposalCount++;
		Proposal storage newProposal = proposals[proposalCount];
		newProposal.id = proposalCount;
		newProposal.proposer = _msgSender();
		newProposal.eta = 0;
		newProposal.targets = targets;
		newProposal.values = values;
		newProposal.signatures = signatures;
		newProposal.calldatas = calldatas;
		newProposal.startBlock = startBlock;
		newProposal.endBlock = endBlock;
		newProposal.forVotes = 0;
		newProposal.againstVotes = 0;
		newProposal.canceled = false;
		newProposal.executed = false;
		newProposal.quoromRequired = quorumVotes();

		latestProposalIds[newProposal.proposer] = newProposal.id;

		emit ProposalCreated(
			newProposal.id,
			_msgSender(),
			targets,
			values,
			signatures,
			calldatas,
			startBlock,
			endBlock,
			description
		);
		return newProposal.id;
	}

	/// @notice helper to set the effective time of a proposal that passed quorom
	/// @dev also extends the ETA in case of a game changer in vote decision
	/// @param proposal the proposal to set the eta
	/// @param hasVoteChanged did the current vote changed the decision
	function _updateETA(Proposal storage proposal, bool hasVoteChanged)
		internal
	{
		//if absolute majority allow to execute immediately
		if (proposal.forVotes > rep.totalSupplyAt(proposal.startBlock) / 2) {
			proposal.eta = block.timestamp;
		}
		//first time we have a quorom we ask for a no change in decision period
		else if (proposal.eta == 0) {
			proposal.eta = block.timestamp + queuePeriod();
		}
		//if we have a gamechanger then we extend current eta to have at least gameChangerPeriod left
		else if (hasVoteChanged) {
			uint256 timeLeft = proposal.eta - block.timestamp;
			proposal.eta += timeLeft > gameChangerPeriod()
				? 0
				: gameChangerPeriod() - timeLeft;
		} else {
			return;
		}
		emit ProposalQueued(proposal.id, proposal.eta);
	}

	/// @notice execute the proposal list of transactions
	/// @dev anyone can call this once its ETA has arrived
	function execute(uint256 proposalId) public payable {
		require(
			state(proposalId) == ProposalState.Succeeded,
			"CompoundVotingMachine::execute: proposal can only be executed if it is succeeded"
		);
		require(
			proposals[proposalId].eta <= block.timestamp,
			"CompoundVotingMachine::execute: proposal can only be executed if no game changers"
		);
		Proposal storage proposal = proposals[proposalId];
		proposal.executed = true;
		for (uint256 i = 0; i < proposal.targets.length; i++) {
			_executeTransaction(
				proposal.targets[i],
				proposal.values[i],
				proposal.signatures[i],
				proposal.calldatas[i]
			);
		}
		emit ProposalExecuted(proposalId);
	}

	/// @notice internal helper to execute a single transaction of a proposal
	/// @dev special execution is done if target is a method in the DAO controller
	function _executeTransaction(
		address target,
		uint256 value,
		string memory signature,
		bytes memory data
	) internal returns (bytes memory) {
		bytes memory callData;

		if (bytes(signature).length == 0) {
			callData = data;
		} else {
			callData = abi.encodePacked(
				bytes4(keccak256(bytes(signature))),
				data
			);
		}

		bool ok;
		bytes memory result;

		if (target == address(dao)) {
			(ok, result) = target.call{ value: value }(callData);
		} else {
			if (value > 0) payable(address(avatar)).transfer(value); //make sure avatar have the funds to pay
			(ok, result) = dao.genericCall(target, callData, avatar, value);
		}
		require(
			ok,
			"CompoundVotingMachine::executeTransaction: Transaction execution reverted."
		);

		//TODO: event with tx result
		return result;
	}

	/// @notice cancel a proposal in case proposer no longer holds the votes that were required to propose
	/// @dev could be cheating trying to bypass the single proposal per address by delegating to another address
	/// or when delegators do not concur with the proposal done in their name, they can withdraw
	function cancel(uint256 proposalId) public {
		ProposalState pState = state(proposalId);
		require(
			pState != ProposalState.Executed,
			"CompoundVotingMachine::cancel: cannot cancel executed proposal"
		);

		Proposal storage proposal = proposals[proposalId];
		require(
			_msgSender() == guardian ||
				rep.getVotesAt(proposal.proposer, true, block.number - 1) <
				proposalThreshold(proposal.startBlock),
			"CompoundVotingMachine::cancel: proposer above threshold"
		);

		proposal.canceled = true;

		emit ProposalCanceled(proposalId);
	}

	/// @notice get the actions to be done in a proposal
	function getActions(uint256 proposalId)
		public
		view
		returns (
			address[] memory targets,
			uint256[] memory values,
			string[] memory signatures,
			bytes[] memory calldatas
		)
	{
		Proposal storage p = proposals[proposalId];
		return (p.targets, p.values, p.signatures, p.calldatas);
	}

	/// @notice get the receipt of a single voter in a proposal
	function getReceipt(uint256 proposalId, address voter)
		public
		view
		returns (Receipt memory)
	{
		return proposals[proposalId].receipts[voter];
	}

	/// @notice get the current status of a proposal
	function state(uint256 proposalId) public view returns (ProposalState) {
		require(
			proposalCount >= proposalId && proposalId > 0,
			"CompoundVotingMachine::state: invalid proposal id"
		);

		Proposal storage proposal = proposals[proposalId];

		if (proposal.canceled) {
			return ProposalState.Canceled;
		} else if (block.number <= proposal.startBlock) {
			return ProposalState.Pending;
		} else if (proposal.executed) {
			return ProposalState.Executed;
		} else if (
			proposal.eta > 0 && block.timestamp < proposal.eta //passed quorum but not executed yet, in time lock
		) {
			return ProposalState.ActiveTimelock;
		} else if (
			//regular voting period
			proposal.eta == 0 && block.number <= proposal.endBlock
		) {
			//proposal is active if we are in the gameChanger period (eta) or no decision yet and in voting period
			return ProposalState.Active;
		} else if (
			proposal.forVotes <= proposal.againstVotes ||
			proposal.forVotes < proposal.quoromRequired
		) {
			return ProposalState.Defeated;
		} else if (
			proposal.eta > 0 && block.timestamp >= proposal.eta + gracePeriod()
		) {
			//expired if not executed gracePeriod after eta
			return ProposalState.Expired;
		} else {
			return ProposalState.Succeeded;
		}
	}

	/// @notice cast your vote on a proposal
	/// @param proposalId the proposal to vote on
	/// @param support for or against
	function castVote(uint256 proposalId, bool support) public {
		//get all votes in all blockchains including delegated
		Proposal storage proposal = proposals[proposalId];
		uint256 votes = rep.getVotesAt(_msgSender(), true, proposal.startBlock);
		return _castVote(_msgSender(), proposal, support, votes);
	}

	struct VoteSig {
		bool support;
		uint8 v;
		bytes32 r;
		bytes32 s;
	}

	// function ecRecoverTest(
	// 	uint256 proposalId,
	// 	VoteSig[] memory votesFor,
	// 	VoteSig[] memory votesAgainst
	// ) public {
	// 	bytes32 domainSeparator =
	// 		keccak256(
	// 			abi.encode(
	// 				DOMAIN_TYPEHASH,
	// 				keccak256(bytes(name)),
	// 				getChainId(),
	// 				address(this)
	// 			)
	// 		);
	// 	bytes32 structHashFor =
	// 		keccak256(abi.encode(BALLOT_TYPEHASH, proposalId, true));
	// 	bytes32 structHashAgainst =
	// 		keccak256(abi.encode(BALLOT_TYPEHASH, proposalId, false));
	// 	bytes32 digestFor =
	// 		keccak256(
	// 			abi.encodePacked("\x19\x01", domainSeparator, structHashFor)
	// 		);
	// 	bytes32 digestAgainst =
	// 		keccak256(
	// 			abi.encodePacked("\x19\x01", domainSeparator, structHashAgainst)
	// 		);

	// 	Proposal storage proposal = proposals[proposalId];

	// 	uint256 total;
	// 	for (uint32 i = 0; i < votesFor.length; i++) {
	// 		bytes32 digest = digestFor;

	// 		address signatory =
	// 			ecrecover(digest, votesFor[i].v, votesFor[i].r, votesFor[i].s);
	// 		require(
	// 			signatory != address(0),
	// 			"CompoundVotingMachine::castVoteBySig: invalid signature"
	// 		);
	// 		require(
	// 			votesFor[i].support == true,
	// 			"CompoundVotingMachine::castVoteBySig: invalid support value in for batch"
	// 		);
	// 		total += rep.getVotesAt(signatory, true, proposal.startBlock);
	// 		Receipt storage receipt = proposal.receipts[signatory];
	// 		receipt.hasVoted = true;
	// 		receipt.support = true;
	// 	}
	// 	if (votesFor.length > 0) {
	// 		address voteAddressHash =
	// 			address(uint160(uint256(keccak256(abi.encode(votesFor)))));
	// 		_castVote(voteAddressHash, proposalId, true, total);
	// 	}

	// 	total = 0;
	// 	for (uint32 i = 0; i < votesAgainst.length; i++) {
	// 		bytes32 digest = digestAgainst;

	// 		address signatory =
	// 			ecrecover(
	// 				digest,
	// 				votesAgainst[i].v,
	// 				votesAgainst[i].r,
	// 				votesAgainst[i].s
	// 			);
	// 		require(
	// 			signatory != address(0),
	// 			"CompoundVotingMachine::castVoteBySig: invalid signature"
	// 		);
	// 		require(
	// 			votesAgainst[i].support == false,
	// 			"CompoundVotingMachine::castVoteBySig: invalid support value in against batch"
	// 		);
	// 		total += rep.getVotesAt(signatory, true, proposal.startBlock);
	// 		Receipt storage receipt = proposal.receipts[signatory];
	// 		receipt.hasVoted = true;
	// 		receipt.support = true;
	// 	}
	// 	if (votesAgainst.length > 0) {
	// 		address voteAddressHash =
	// 			address(uint160(uint256(keccak256(abi.encode(votesAgainst)))));
	// 		_castVote(voteAddressHash, proposalId, false, total);
	// 	}
	// }

	/// @notice helper to cast a vote for someone else by using eip712 signatures
	function castVoteBySig(
		uint256 proposalId,
		bool support,
		uint8 v,
		bytes32 r,
		bytes32 s
	) public {
		bytes32 domainSeparator =
			keccak256(
				abi.encode(
					DOMAIN_TYPEHASH,
					keccak256(bytes(name)),
					getChainId(),
					address(this)
				)
			);
		bytes32 structHash =
			keccak256(abi.encode(BALLOT_TYPEHASH, proposalId, support));
		bytes32 digest =
			keccak256(
				abi.encodePacked("\x19\x01", domainSeparator, structHash)
			);
		address signatory = ecrecover(digest, v, r, s);
		require(
			signatory != address(0),
			"CompoundVotingMachine::castVoteBySig: invalid signature"
		);

		//get all votes in all blockchains including delegated
		Proposal storage proposal = proposals[proposalId];
		uint256 votes = rep.getVotesAt(signatory, true, proposal.startBlock);
		return _castVote(signatory, proposal, support, votes);
	}

	/// @notice internal helper to cast a vote
	function _castVote(
		address voter,
		Proposal storage proposal,
		bool support,
		uint256 votes
	) internal {
		uint256 proposalId = proposal.id;
		require(
			state(proposalId) == ProposalState.Active ||
				state(proposalId) == ProposalState.ActiveTimelock,
			"CompoundVotingMachine::_castVote: voting is closed"
		);

		Receipt storage receipt = proposal.receipts[voter];
		require(
			receipt.hasVoted == false,
			"CompoundVotingMachine::_castVote: voter already voted"
		);

		bool hasChanged = proposal.forVotes > proposal.againstVotes;
		if (support) {
			proposal.forVotes += votes;
		} else {
			proposal.againstVotes += votes;
		}

		hasChanged = hasChanged != (proposal.forVotes > proposal.againstVotes);
		receipt.hasVoted = true;
		receipt.support = support;
		receipt.votes = votes;

		// if quorom passed then start the queue period
		if (
			proposal.forVotes >= proposal.quoromRequired ||
			proposal.againstVotes >= proposal.quoromRequired
		) _updateETA(proposal, hasChanged);
		emit VoteCast(voter, proposalId, support, votes);
	}

	function getChainId() public view returns (uint256) {
		uint256 chainId;
		assembly {
			chainId := chainid()
		}
		return chainId;
	}

	function renounceGuardian() public {
		require(
			_msgSender() == guardian,
			"CompoundVotingMachine: not guardian"
		);
		guardian = address(0);
		foundationGuardianRelease = 0;
	}

	function setGuardian(address _guardian) public {
		require(
			_msgSender() == address(avatar) || _msgSender() == guardian,
			"CompoundVotingMachine: not avatar or guardian"
		);

		require(
			_msgSender() == guardian ||
				block.timestamp > foundationGuardianRelease,
			"CompoundVotingMachine: foundation expiration not reached"
		);

		guardian = _guardian;
	}
}
