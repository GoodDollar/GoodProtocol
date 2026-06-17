// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../Interfaces.sol";
import "../token/ERC677.sol";
import "../utils/DAOUpgradeableContract.sol";
import "./IFlowSplitter.sol";

contract GoodDaoHouses is
	AccessControlUpgradeable,
	PausableUpgradeable,
	ReentrancyGuardUpgradeable,
	DAOUpgradeableContract,
	ERC677Receiver
{
	bytes32 public constant GOVERNANCE_COMMITTEE_ROLE =
		keccak256("GOVERNANCE_COMMITTEE_ROLE");

	uint256 public constant HOUSE_ALIGNMENT_WEIGHT = 40;
	uint256 public constant HOUSE_CITIZENS_WEIGHT = 4;
	uint256 public constant BASIS_POINTS = 10000;
	uint64 public constant DEFAULT_TERM_DURATION = 90 days;
	uint64 public constant DEFAULT_VOTING_TERM_LENGTH = 7 days;

	enum House {
		Citizens,
		Alignment
	}

	enum MemberStatus {
		None,
		Pending,
		Active,
		Revoked,
		Unstaked
	}

	struct MemberRecord {
		House house;
		MemberStatus status;
		uint256 stakedAmount;
		uint64 joinedAt;
		uint64 updatedAt;
		uint64 unstakedAt;
		string name;
		string socialLinks;
		string projectWebpage;
		string missionStatement;
		string distributionStrategy;
	}

	struct EligibilityRecord {
		bool isEligible;
		uint64 listedAt;
		uint64 updatedAt;
		uint64 delistedAt;
	}

	struct VoteConfig {
		uint64 startTime;
		uint64 endTime;
		uint64 executedAt;
		bool executed;
	}

	struct FlowSplitterConfig {
		address splitter;
		uint256 poolId;
		address poolAddress;
	}

	mapping(address => MemberRecord) private _members;
	mapping(address => EligibilityRecord) private _alignmentEligibility;
	mapping(House => uint256) public minimumStake;
	address[] private _memberAccounts;
	mapping(address => bool) private _knownMember;
	uint64 public termDuration;
	uint64 public votingTermLength;

	uint256 public voteCount;
	mapping(uint256 => VoteConfig) private _votes;
	mapping(uint256 => address[]) private _voteRecipients;
	mapping(uint256 => mapping(address => bool)) private _isVoteRecipient;
	mapping(uint256 => mapping(address => uint256))
		private _voteRecipientWeightedVotes;
	mapping(uint256 => mapping(address => address[])) private _voterBallotRecipients;
	mapping(uint256 => mapping(address => mapping(address => uint256)))
		private _voterBallotBps;

	FlowSplitterConfig private _flowSplitterConfig;

	event StakeRequirementSet(House indexed house, uint256 amount);
	event AlignmentEligibilityUpdated(address indexed account, bool isEligible);
	event MemberRegistered(
		address indexed account,
		House indexed house,
		MemberStatus status,
		uint256 amount
	);
	event MemberApproved(address indexed account, House indexed house);
	event MemberRevoked(address indexed account, House indexed house);
	event MemberStaked(address indexed account, House indexed house, uint256 amount);
	event MemberUnstaked(address indexed account, House indexed house, uint256 amount);
	event VoteCreated(
		uint256 indexed voteId,
		uint64 startTime,
		uint64 endTime
	);
	event VoteUpdated(uint256 indexed voteId, address indexed voter);
	event VoteExecuted(uint256 indexed voteId, uint256 poolId, address poolAddress);
	event FlowSplitterConfigured(
		address indexed splitter,
		uint256 indexed poolId,
		address poolAddress
	);

	function initialize(
		INameService _ns,
		address admin,
		address committee,
		uint256 citizensMinimumStake,
		uint256 alignmentMinimumStake
	) public initializer {
		__AccessControl_init();
		__Pausable_init();
		__ReentrancyGuard_init();
		__UUPSUpgradeable_init();

		setDAO(_ns);

		_grantRole(DEFAULT_ADMIN_ROLE, admin);
		_grantRole(GOVERNANCE_COMMITTEE_ROLE, committee);
		if (admin != committee) {
			_grantRole(GOVERNANCE_COMMITTEE_ROLE, admin);
		}

		minimumStake[House.Citizens] = citizensMinimumStake;
		minimumStake[House.Alignment] = alignmentMinimumStake;
		termDuration = DEFAULT_TERM_DURATION;
		votingTermLength = DEFAULT_VOTING_TERM_LENGTH;

		emit StakeRequirementSet(House.Citizens, citizensMinimumStake);
		emit StakeRequirementSet(House.Alignment, alignmentMinimumStake);
	}

	function setStakeRequirement(House house, uint256 amount)
		external
		onlyRole(GOVERNANCE_COMMITTEE_ROLE)
	{
		minimumStake[house] = amount;
		emit StakeRequirementSet(house, amount);
	}

	function setAlignmentEligibility(address account, bool isEligible)
		external
		onlyRole(GOVERNANCE_COMMITTEE_ROLE)
	{
		EligibilityRecord storage eligibility = _alignmentEligibility[account];
		eligibility.isEligible = isEligible;
		eligibility.updatedAt = uint64(block.timestamp);
		if (isEligible) {
			if (eligibility.listedAt == 0) {
				eligibility.listedAt = uint64(block.timestamp);
			}
			eligibility.delistedAt = 0;
		} else {
			eligibility.delistedAt = uint64(block.timestamp);
		}

		emit AlignmentEligibilityUpdated(account, isEligible);
	}

	function registerAndStake(
		House house,
		uint256 amount,
		string calldata name,
		string calldata socialLinks,
		string calldata projectWebpage,
		string calldata missionStatement,
		string calldata distributionStrategy
		) external whenNotPaused {
			require(
				_goodDollar().transferFrom(msg.sender, address(this), amount),
				"G$ transferFrom failed"
			);
		_registerMember(
			msg.sender,
			house,
			amount,
			name,
			socialLinks,
			projectWebpage,
			missionStatement,
			distributionStrategy
		);
	}

	function stake(uint256 amount) external whenNotPaused {
		require(
			_goodDollar().transferFrom(msg.sender, address(this), amount),
			"G$ transferFrom failed"
		);
		_addStake(msg.sender, amount);
	}

	function onTokenTransfer(
		address _from,
		uint256 _amount,
		bytes calldata _data
	) external override whenNotPaused returns (bool success) {
		require(msg.sender == address(_goodDollar()), "Only G$ token can call");

		if (_data.length == 0) {
			_addStake(_from, _amount);
			return true;
		}

		(
			House house,
			string memory name,
			string memory socialLinks,
			string memory projectWebpage,
			string memory missionStatement,
			string memory distributionStrategy
		) = abi.decode(
			_data,
			(House, string, string, string, string, string)
		);
		_registerMember(
			_from,
			house,
			_amount,
			name,
			socialLinks,
			projectWebpage,
			missionStatement,
			distributionStrategy
		);
		return true;
	}

	function approveAlignmentMember(address account)
		external
		onlyRole(GOVERNANCE_COMMITTEE_ROLE)
		whenNotPaused
	{
		MemberRecord storage member = _members[account];
		require(
			member.house == House.Alignment,
			"Member is not in Alignment house"
		);
		require(
			member.status == MemberStatus.Pending,
			"Alignment member is not pending"
		);
		require(
			_alignmentEligibility[account].isEligible,
			"Alignment member is not eligible"
		);
		require(
			member.stakedAmount >= minimumStake[House.Alignment],
			"Stake is below Alignment minimum"
		);

		member.status = MemberStatus.Active;
		member.updatedAt = uint64(block.timestamp);

		emit MemberApproved(account, member.house);
	}

	function revokeMember(address account)
		external
		onlyRole(GOVERNANCE_COMMITTEE_ROLE)
		whenNotPaused
	{
		MemberRecord storage member = _members[account];
		require(
			member.status == MemberStatus.Active ||
				member.status == MemberStatus.Pending,
			"Member is not active or pending"
		);

		member.status = MemberStatus.Revoked;
		member.updatedAt = uint64(block.timestamp);

		_clearMemberUnits(account);
		emit MemberRevoked(account, member.house);
	}

	function unstake() external nonReentrant whenNotPaused {
		MemberRecord storage member = _members[msg.sender];
		uint256 amount = member.stakedAmount;

		require(amount > 0, "No stake to unstake");

		member.stakedAmount = 0;
		member.status = MemberStatus.Unstaked;
		member.updatedAt = uint64(block.timestamp);
		member.unstakedAt = uint64(block.timestamp);

		_clearMemberUnits(msg.sender);

		require(_goodDollar().transfer(msg.sender, amount), "G$ transfer failed");

		emit MemberUnstaked(msg.sender, member.house, amount);
	}

	function castVote(address[] calldata recipients, uint256[] calldata allocations)
		external
		whenNotPaused
	{
		(uint256 voteId, uint64 voteStartTime) = _getCurrentVoteWindow();
		uint256 voterWeight = _getVoterWeight(msg.sender, voteStartTime);

		require(_isVotingPeriod(block.timestamp), "Voting period is closed");
		require(voterWeight > 0, "Voter is not eligible for this term");

		if (_votes[voteId].startTime == 0) {
			_createAlignmentVote(voteId, voteStartTime);
		}

		VoteConfig storage vote = _votes[voteId];
		require(!vote.executed, "Vote already executed");
		require(
			recipients.length == allocations.length,
			"Recipients and allocations length mismatch"
		);
		require(recipients.length > 0, "Ballot must include at least one recipient");

		uint256 allocationTotal;
		for (uint256 i = 0; i < recipients.length; i++) {
			require(
				_isVoteRecipient[voteId][recipients[i]],
				"Recipient is not eligible for this vote"
			);
			for (uint256 j = i + 1; j < recipients.length; j++) {
				require(recipients[i] != recipients[j], "Duplicate recipient in ballot");
			}
			allocationTotal += allocations[i];
		}
		require(
			allocationTotal == BASIS_POINTS,
			"Allocations must sum to 10000 basis points"
		);

		_clearBallot(voteId, msg.sender, voterWeight);

		address[] storage storedRecipients = _voterBallotRecipients[voteId][
			msg.sender
		];
		for (uint256 i = 0; i < recipients.length; i++) {
			address recipient = recipients[i];
			uint256 allocation = allocations[i];
			storedRecipients.push(recipient);
			_voterBallotBps[voteId][msg.sender][recipient] = allocation;
			_voteRecipientWeightedVotes[voteId][recipient] +=
				(allocation * voterWeight) /
				BASIS_POINTS;
		}

		emit VoteUpdated(voteId, msg.sender);
	}

	function executeVote(uint256 voteId)
		external
		onlyRole(GOVERNANCE_COMMITTEE_ROLE)
		whenNotPaused
	{
		VoteConfig storage vote = _votes[voteId];
		FlowSplitterConfig storage flowConfig = _flowSplitterConfig;
		address[] storage recipients = _voteRecipients[voteId];
		IFlowSplitter.Member[] memory members = new IFlowSplitter.Member[](
			recipients.length
		);

		require(vote.startTime > 0, "Vote does not exist");
		require(block.timestamp > vote.endTime, "Voting window is still open");
		require(!vote.executed, "Vote already executed");
		require(flowConfig.splitter != address(0), "FlowSplitter is not configured");
		require(flowConfig.poolId > 0, "FlowSplitter pool is not configured");

		for (uint256 i = 0; i < recipients.length; i++) {
			address recipient = recipients[i];
			members[i] = IFlowSplitter.Member({
				account: recipient,
				units: uint128(_voteRecipientWeightedVotes[voteId][recipient])
			});
		}

		IFlowSplitter(flowConfig.splitter).updateMembersUnits(
			flowConfig.poolId,
			members
		);

		vote.executed = true;
		vote.executedAt = uint64(block.timestamp);

		emit VoteExecuted(voteId, flowConfig.poolId, flowConfig.poolAddress);
	}

	function configureFlowSplitter(address splitter, uint256 poolId)
		external
		onlyRole(GOVERNANCE_COMMITTEE_ROLE)
	{
		require(splitter != address(0), "FlowSplitter address is required");
		require(poolId > 0, "FlowSplitter pool id is required");

		IFlowSplitter.Pool memory pool = IFlowSplitter(splitter).getPoolById(poolId);
		require(pool.poolAddress != address(0), "FlowSplitter pool not found");
		require(
			IFlowSplitter(splitter).isPoolAdmin(poolId, address(this)),
			"GoodDaoHouses is not a pool admin"
		);

		_flowSplitterConfig.splitter = splitter;
		_flowSplitterConfig.poolId = pool.id;
		_flowSplitterConfig.poolAddress = pool.poolAddress;

		emit FlowSplitterConfigured(splitter, pool.id, pool.poolAddress);
	}

	function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
		_pause();
	}

	function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
		_unpause();
	}

	function getMember(address account)
		external
		view
		returns (MemberRecord memory)
	{
		return _members[account];
	}

	function getAlignmentEligibility(address account)
		external
		view
		returns (EligibilityRecord memory)
	{
		return _alignmentEligibility[account];
	}

	function isActiveMember(address account, House house)
		external
		view
		returns (bool)
	{
		MemberRecord storage member = _members[account];
		return member.house == house && member.status == MemberStatus.Active;
	}

	function getActiveMembers(House house)
		external
		view
		returns (address[] memory)
	{
		uint256 activeCount;
		for (uint256 i = 0; i < _memberAccounts.length; i++) {
			MemberRecord storage member = _members[_memberAccounts[i]];
			if (member.house == house && member.status == MemberStatus.Active) {
				activeCount++;
			}
		}

		address[] memory activeMembers = new address[](activeCount);
		uint256 index;
		for (uint256 i = 0; i < _memberAccounts.length; i++) {
			address account = _memberAccounts[i];
			MemberRecord storage member = _members[account];
			if (member.house == house && member.status == MemberStatus.Active) {
				activeMembers[index] = account;
				index++;
			}
		}

		return activeMembers;
	}

	function getVote(uint256 voteId) external view returns (VoteConfig memory) {
		return _votes[voteId];
	}

	function getVoteRecipients(uint256 voteId)
		external
		view
		returns (address[] memory)
	{
		return _voteRecipients[voteId];
	}

	function getVoteVoters(uint256 voteId)
		external
		view
		returns (
			address[] memory alignmentVoters,
			address[] memory citizensVoters
		)
	{
		VoteConfig storage vote = _votes[voteId];
		uint256 alignmentCount;
		uint256 citizensCount;

		for (uint256 i = 0; i < _memberAccounts.length; i++) {
			MemberRecord storage member = _members[_memberAccounts[i]];
			if (
				member.status != MemberStatus.Active || member.joinedAt > vote.startTime
			) {
				continue;
			}

			if (member.house == House.Alignment) {
				alignmentCount++;
			} else if (member.house == House.Citizens) {
				citizensCount++;
			}
		}

		alignmentVoters = new address[](alignmentCount);
		citizensVoters = new address[](citizensCount);
		uint256 alignmentIndex;
		uint256 citizensIndex;

		for (uint256 i = 0; i < _memberAccounts.length; i++) {
			address account = _memberAccounts[i];
			MemberRecord storage member = _members[account];
			if (
				member.status != MemberStatus.Active || member.joinedAt > vote.startTime
			) {
				continue;
			}

			if (member.house == House.Alignment) {
				alignmentVoters[alignmentIndex] = account;
				alignmentIndex++;
			} else if (member.house == House.Citizens) {
				citizensVoters[citizensIndex] = account;
				citizensIndex++;
			}
		}
	}

	function getBallot(uint256 voteId, address voter)
		external
		view
		returns (address[] memory recipients, uint256[] memory allocations)
	{
		recipients = _voterBallotRecipients[voteId][voter];
		allocations = new uint256[](recipients.length);
		for (uint256 i = 0; i < recipients.length; i++) {
			allocations[i] = _voterBallotBps[voteId][voter][recipients[i]];
		}
	}

	function getFinalizedUnits(uint256 voteId, address recipient)
		external
		view
		returns (uint128)
	{
		return uint128(_voteRecipientWeightedVotes[voteId][recipient]);
	}

	function getCurrentVoteId() external view returns (uint256) {
		(uint256 voteId, ) = _getCurrentVoteWindow();
		return voteId;
	}

	function isVotingPeriod() external view returns (bool) {
		return _isVotingPeriod(block.timestamp);
	}

	function getFlowSplitterConfig()
		external
		view
		returns (FlowSplitterConfig memory)
	{
		return _flowSplitterConfig;
	}

	function _registerMember(
		address account,
		House house,
		uint256 amount,
		string memory name,
		string memory socialLinks,
		string memory projectWebpage,
		string memory missionStatement,
		string memory distributionStrategy
	) internal {
		MemberRecord storage member = _members[account];
		uint64 joinedAt = member.joinedAt == 0
			? uint64(block.timestamp)
			: member.joinedAt;

		require(amount >= minimumStake[house], "Stake is below house minimum");
		require(
			member.status == MemberStatus.None ||
				member.status == MemberStatus.Unstaked,
			"Member already registered"
		);

		if (house == House.Alignment) {
			require(
				_alignmentEligibility[account].isEligible,
				"Alignment member is not eligible"
			);
		}

		_members[account] = MemberRecord({
			house: house,
			status: house == House.Alignment
				? MemberStatus.Pending
				: MemberStatus.Active,
			stakedAmount: amount,
			joinedAt: joinedAt,
			updatedAt: uint64(block.timestamp),
			unstakedAt: 0,
			name: name,
			socialLinks: socialLinks,
			projectWebpage: projectWebpage,
			missionStatement: missionStatement,
			distributionStrategy: distributionStrategy
		});

		if (!_knownMember[account]) {
			_knownMember[account] = true;
			_memberAccounts.push(account);
		}

		emit MemberRegistered(account, house, _members[account].status, amount);
	}

	function _addStake(address account, uint256 amount) internal {
		MemberRecord storage member = _members[account];
		require(member.status != MemberStatus.None, "Member not found");
		require(member.status != MemberStatus.Unstaked, "Cannot add stake after unstake");

		member.stakedAmount += amount;
		member.updatedAt = uint64(block.timestamp);

		emit MemberStaked(account, member.house, amount);
	}

	function _clearBallot(
		uint256 voteId,
		address voter,
		uint256 voterWeight
	) internal {
		address[] storage previousRecipients = _voterBallotRecipients[voteId][voter];

		for (uint256 i = 0; i < previousRecipients.length; i++) {
			address recipient = previousRecipients[i];
			uint256 previousAllocation = _voterBallotBps[voteId][voter][recipient];
			if (previousAllocation > 0) {
				_voteRecipientWeightedVotes[voteId][recipient] -=
					(previousAllocation * voterWeight) /
					BASIS_POINTS;
				delete _voterBallotBps[voteId][voter][recipient];
			}
		}

		delete _voterBallotRecipients[voteId][voter];
	}

	function _createAlignmentVote(uint256 voteId, uint64 voteStartTime) internal {
		uint64 voteEndTime = voteStartTime + votingTermLength;
		uint256 recipientCount;

		for (uint256 i = 0; i < _memberAccounts.length; i++) {
			MemberRecord storage member = _members[_memberAccounts[i]];
			if (
				member.house == House.Alignment &&
				member.status == MemberStatus.Active &&
				member.joinedAt <= voteStartTime
			) {
				recipientCount++;
			}
		}

		require(recipientCount > 0, "No active Alignment members for this vote");

		VoteConfig storage vote = _votes[voteId];
		vote.startTime = voteStartTime;
		vote.endTime = voteEndTime;

		for (uint256 i = 0; i < _memberAccounts.length; i++) {
			address account = _memberAccounts[i];
			MemberRecord storage member = _members[account];
			if (
				member.house == House.Alignment &&
				member.status == MemberStatus.Active &&
				member.joinedAt <= voteStartTime
			) {
				_voteRecipients[voteId].push(account);
				_isVoteRecipient[voteId][account] = true;
			}
		}

		if (voteId > voteCount) {
			voteCount = voteId;
		}

		emit VoteCreated(voteId, voteStartTime, voteEndTime);
	}

	function _clearMemberUnits(address account) internal {
		if (
			_flowSplitterConfig.splitter == address(0) ||
			_flowSplitterConfig.poolId == 0
		) {
			return;
		}

		IFlowSplitter.Member[]
			memory members = new IFlowSplitter.Member[](1);
		members[0] = IFlowSplitter.Member({ account: account, units: 0 });
		IFlowSplitter(_flowSplitterConfig.splitter).updateMembersUnits(
			_flowSplitterConfig.poolId,
			members
		);
	}

	function _getCurrentVoteWindow()
		internal
		view
		returns (uint256 voteId, uint64 voteStartTime)
	{
		voteId = block.timestamp / termDuration;
		voteStartTime = uint64(voteId * termDuration);
	}

	function _getVoterWeight(address voter, uint64 voteStartTime)
		internal
		view
		returns (uint256)
	{
		MemberRecord storage member = _members[voter];
		if (
			member.status != MemberStatus.Active ||
			member.joinedAt == 0 ||
			member.joinedAt > voteStartTime
		) {
			return 0;
		}

		if (member.house == House.Alignment) {
			return HOUSE_ALIGNMENT_WEIGHT;
		}

		if (member.house == House.Citizens) {
			return HOUSE_CITIZENS_WEIGHT;
		}

		return 0;
	}

	function _isVotingPeriod(uint256 timestamp) internal view returns (bool) {
		return timestamp % termDuration <= votingTermLength;
	}

	function _goodDollar() internal view returns (IGoodDollar) {
		return IGoodDollar(nameService.getAddress("GOODDOLLAR"));
	}

	uint256[42] private __gap;
}
