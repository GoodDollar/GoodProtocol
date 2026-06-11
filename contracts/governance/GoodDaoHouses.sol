// SPDX-License-Identifier: MIT

pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../Interfaces.sol";
import "../token/ERC677.sol";
import "../utils/DAOUpgradeableContract.sol";
import "./IFlowSplitter.sol";

interface IFlowSplitterCounter is IFlowSplitter {
	function poolCounter() external view returns (uint256);
}

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
		address superToken;
		string metadata;
		string poolName;
		string poolSymbol;
		uint8 poolDecimals;
		bool transferabilityForUnitsOwner;
		bool distributionFromAnyAddress;
		uint256 poolId;
		address poolAddress;
		bool poolInitialized;
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
	event FlowSplitterConfigured(address indexed splitter, address indexed superToken);
	event FlowSplitterPoolCreated(uint256 indexed poolId, address poolAddress);
	event FlowSplitterMetadataUpdated(uint256 indexed poolId, string metadata);

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
			"TF"
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
			"TF"
		);
		_addStake(msg.sender, amount);
	}

	function onTokenTransfer(
		address _from,
		uint256 _amount,
		bytes calldata _data
	) external override whenNotPaused returns (bool success) {
		require(msg.sender == address(_goodDollar()), "UT");

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
		require(member.house == House.Alignment, "WH");
		require(member.status == MemberStatus.Pending, "NP");
		require(
			_alignmentEligibility[account].isEligible,
			"NE"
		);
		require(
			member.stakedAmount >= minimumStake[House.Alignment],
			"SBM"
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
			"NA"
		);

		member.status = MemberStatus.Revoked;
		member.updatedAt = uint64(block.timestamp);

		_clearMemberUnits(account);
		emit MemberRevoked(account, member.house);
	}

	function unstake() external nonReentrant whenNotPaused {
		MemberRecord storage member = _members[msg.sender];
		uint256 amount = member.stakedAmount;

		require(amount > 0, "NS");

		member.stakedAmount = 0;
		member.status = MemberStatus.Unstaked;
		member.updatedAt = uint64(block.timestamp);
		member.unstakedAt = uint64(block.timestamp);

		_clearMemberUnits(msg.sender);

		require(_goodDollar().transfer(msg.sender, amount), "WTF");

		emit MemberUnstaked(msg.sender, member.house, amount);
	}

	function castVote(address[] calldata recipients, uint256[] calldata allocations)
		external
		whenNotPaused
	{
		(uint256 voteId, uint64 voteStartTime) = _getCurrentVoteWindow();
		uint256 voterWeight = _getVoterWeight(msg.sender, voteStartTime);

		require(_isVotingPeriod(block.timestamp), "VNP");
		require(voterWeight > 0, "VE");

		if (_votes[voteId].startTime == 0) {
			_createAlignmentVote(voteId, voteStartTime);
		}

		VoteConfig storage vote = _votes[voteId];
		require(!vote.executed, "VAE");
		require(recipients.length == allocations.length, "LM");
		require(recipients.length > 0, "EB");

		uint256 allocationTotal;
		for (uint256 i = 0; i < recipients.length; i++) {
			require(_isVoteRecipient[voteId][recipients[i]], "IR");
			for (uint256 j = i + 1; j < recipients.length; j++) {
				require(recipients[i] != recipients[j], "DR");
			}
			allocationTotal += allocations[i];
		}
		require(allocationTotal == BASIS_POINTS, "ASI");

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

		require(vote.startTime > 0, "VNF");
		require(block.timestamp > vote.endTime, "VSO");
		require(!vote.executed, "VAE");
		require(flowConfig.splitter != address(0), "FNC");
		require(flowConfig.superToken != address(0), "STNC");

		for (uint256 i = 0; i < recipients.length; i++) {
			address recipient = recipients[i];
			members[i] = IFlowSplitter.Member({
				account: recipient,
				units: uint128(_voteRecipientWeightedVotes[voteId][recipient])
			});
		}

		if (!flowConfig.poolInitialized) {
			address[] memory admins = new address[](1);
			admins[0] = address(this);

			ISuperfluidPool pool = IFlowSplitter(flowConfig.splitter).createPool(
				ISuperToken(flowConfig.superToken),
				PoolConfig({
					transferabilityForUnitsOwner: flowConfig
						.transferabilityForUnitsOwner,
					distributionFromAnyAddress: flowConfig.distributionFromAnyAddress
				}),
				PoolERC20Metadata({
					name: flowConfig.poolName,
					symbol: flowConfig.poolSymbol,
					decimals: flowConfig.poolDecimals
				}),
				members,
				admins,
				flowConfig.metadata
			);

			flowConfig.poolId = IFlowSplitterCounter(flowConfig.splitter)
				.poolCounter();
			IFlowSplitter.Pool memory poolInfo = IFlowSplitter(flowConfig.splitter)
				.getPoolById(flowConfig.poolId);

			flowConfig.poolInitialized = true;
			flowConfig.poolAddress = poolInfo.poolAddress == address(0)
				? address(pool)
				: poolInfo.poolAddress;

			emit FlowSplitterPoolCreated(
				flowConfig.poolId,
				flowConfig.poolAddress
			);
		} else {
			IFlowSplitter(flowConfig.splitter).updateMembersUnits(
				flowConfig.poolId,
				members
			);
		}

		vote.executed = true;
		vote.executedAt = uint64(block.timestamp);

		emit VoteExecuted(voteId, flowConfig.poolId, flowConfig.poolAddress);
	}

	function configureFlowSplitter(
		address splitter,
		address superToken,
		string calldata metadata,
		string calldata poolName,
		string calldata poolSymbol,
		uint8 poolDecimals,
		bool transferabilityForUnitsOwner,
		bool distributionFromAnyAddress
	) external onlyRole(GOVERNANCE_COMMITTEE_ROLE) {
		_flowSplitterConfig.splitter = splitter;
		_flowSplitterConfig.superToken = superToken;
		_flowSplitterConfig.metadata = metadata;
		_flowSplitterConfig.poolName = poolName;
		_flowSplitterConfig.poolSymbol = poolSymbol;
		_flowSplitterConfig.poolDecimals = poolDecimals;
		_flowSplitterConfig.transferabilityForUnitsOwner = transferabilityForUnitsOwner;
		_flowSplitterConfig.distributionFromAnyAddress = distributionFromAnyAddress;

		emit FlowSplitterConfigured(splitter, superToken);
	}

	function syncFlowSplitterPool(uint256 poolId)
		external
		onlyRole(GOVERNANCE_COMMITTEE_ROLE)
	{
		IFlowSplitter.Pool memory pool = IFlowSplitter(_flowSplitterConfig.splitter)
			.getPoolById(poolId);
		require(pool.poolAddress != address(0), "PNF");

		_flowSplitterConfig.poolId = pool.id;
		_flowSplitterConfig.poolAddress = pool.poolAddress;
		_flowSplitterConfig.poolInitialized = true;
	}

	function syncFlowSplitterMetadata(string calldata metadata)
		external
		onlyRole(GOVERNANCE_COMMITTEE_ROLE)
	{
		_flowSplitterConfig.metadata = metadata;
		if (_flowSplitterConfig.poolInitialized) {
			IFlowSplitter(_flowSplitterConfig.splitter).updatePoolMetadata(
				_flowSplitterConfig.poolId,
				metadata
			);
			emit FlowSplitterMetadataUpdated(
				_flowSplitterConfig.poolId,
				metadata
			);
		}
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

		require(amount >= minimumStake[house], "SBM");
		require(
			member.status == MemberStatus.None ||
				member.status == MemberStatus.Unstaked,
			"MAR"
		);

		if (house == House.Alignment) {
			require(
				_alignmentEligibility[account].isEligible,
				"NE"
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
		require(member.status != MemberStatus.None, "MNF");
		require(member.status != MemberStatus.Unstaked, "MU");

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

		require(recipientCount > 0, "NAM");

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
		if (!_flowSplitterConfig.poolInitialized) {
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
