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

	uint256 public constant BASIS_POINTS = 10000;

	// multiply by BASIS_POINTS to get the weight in basis points for each house so a 1 basis-point vote is non-zero
	uint256 public constant HOUSE_ALIGNMENT_WEIGHT = 40 * BASIS_POINTS;
	uint256 public constant HOUSE_CITIZENS_WEIGHT = 4 * BASIS_POINTS;
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
		uint256 memberIndex;
		string name;
		string socialLinks;
		string projectWebpage;
		string missionStatement;
		string distributionStrategy;
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

	mapping(address => MemberRecord) private members;
	mapping(House => uint256) public minimumStake;
	address[] private hoaMembers;
	address[] private hocMembers;
	uint64 public cycleStartTime;
	uint64 public termDuration;
	uint64 public votingTermLength;

	uint256 public voteCount;
	mapping(uint256 => VoteConfig) private votes;
	mapping(uint256 => address[]) private voteRecipients;
	mapping(uint256 => mapping(address => bool)) private isVoteRecipient;
	mapping(uint256 => mapping(address => uint256))
		private voteRecipientWeightedVotes;
	mapping(uint256 => mapping(address => bool)) private hasVoted;

	FlowSplitterConfig public flowSplitterConfig;

	uint256[50] private __gap;

	event StakeRequirementSet(House indexed house, uint256 amount);
	event MemberRegistered(
		address indexed account,
		House indexed house,
		MemberStatus status,
		uint256 amount
	);
	event MemberApproved(address indexed account, House indexed house);
	event MemberRevoked(address indexed account, House indexed house);
	event MemberStaked(
		address indexed account,
		House indexed house,
		uint256 amount
	);
	event MemberUnstaked(
		address indexed account,
		House indexed house,
		uint256 amount
	);
	event VoteCreated(
		uint256 indexed voteId,
		uint64 startTime,
		uint64 endTime,
		address[] recipients
	);
	event VoteCast(
		uint256 indexed voteId,
		address indexed voter,
		address[] recipients,
		uint256[] allocations
	);
	event VoteExecuted(
		uint256 indexed voteId,
		uint256 poolId,
		address poolAddress,
		address[] recipients,
		uint128[] weights
	);
	event FlowSplitterConfigured(
		address indexed splitter,
		uint256 indexed poolId,
		address poolAddress
	);
	event VotingScheduleUpdated(
		uint64 cycleStartTime,
		uint64 termDuration,
		uint64 votingTermLength
	);

	modifier onlyAdminOrCommittee() {
		require(
			hasRole(DEFAULT_ADMIN_ROLE, msg.sender) ||
				hasRole(GOVERNANCE_COMMITTEE_ROLE, msg.sender),
			"Not admin/committee"
		);
		_;
	}

	/// @notice Initializes the governance houses contract and role assignments.
	/// @param _ns NameService registry used to resolve protocol contract addresses.
	/// @param admin Address receiving the default admin role.
	/// @param committee Address receiving the governance committee role.
	/// @param citizensMinimumStake Minimum G$ stake required for Citizens members.
	/// @param alignmentMinimumStake Minimum G$ stake required for Alignment members.
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
		cycleStartTime = uint64(block.timestamp);
		termDuration = DEFAULT_TERM_DURATION;
		votingTermLength = DEFAULT_VOTING_TERM_LENGTH;

		emit StakeRequirementSet(House.Citizens, citizensMinimumStake);
		emit StakeRequirementSet(House.Alignment, alignmentMinimumStake);
		emit VotingScheduleUpdated(cycleStartTime, termDuration, votingTermLength);
	}

	/// @notice Updates the minimum stake required for a house.
	/// @param house House whose threshold is being updated.
	/// @param amount New minimum stake amount in G$.
	function setStakeRequirement(
		House house,
		uint256 amount
	) external onlyRole(GOVERNANCE_COMMITTEE_ROLE) {
		minimumStake[house] = amount;
		emit StakeRequirementSet(house, amount);
	}

	/// @notice Updates the recurring voting schedule parameters.
	/// @param newCycleStartTime Start timestamp used as the cycle anchor.
	/// @param newTermDuration Duration of a term in seconds.
	/// @param newVotingTermLength Duration of the voting window in each term.
	function setVotingSchedule(
		uint64 newCycleStartTime,
		uint64 newTermDuration,
		uint64 newVotingTermLength
	) external onlyAdminOrCommittee {
		require(newTermDuration > 0, "Term=0");
		require(newVotingTermLength <= newTermDuration, "Vote term > term");

		cycleStartTime = newCycleStartTime;
		termDuration = newTermDuration;
		votingTermLength = newVotingTermLength;

		emit VotingScheduleUpdated(cycleStartTime, termDuration, votingTermLength);
	}

	/// @notice Registers the caller in a house and tops up stake to the minimum if needed.
	/// @param house Target house for membership.
	/// @param name Display name persisted for the member profile.
	/// @param socialLinks Social links metadata for the member profile.
	/// @param projectWebpage Project webpage metadata for the member profile.
	/// @param missionStatement Mission statement metadata for the member profile.
	/// @param distributionStrategy Distribution strategy metadata for the member profile.
	function registerAndStake(
		House house,
		string calldata name,
		string calldata socialLinks,
		string calldata projectWebpage,
		string calldata missionStatement,
		string calldata distributionStrategy
	) external whenNotPaused {
		// Collect only the missing delta between current stake and the house minimum.
		int256 delta = int256(minimumStake[house]) -
			int256(members[msg.sender].stakedAmount);
		uint256 transferAmount = 0;
		if (delta > 0) {
			transferAmount = uint256(delta);
			require(
				_goodDollar().transferFrom(msg.sender, address(this), transferAmount),
				"G$ transferFrom"
			);
		}

		_registerMember(
			msg.sender,
			house,
			transferAmount,
			name,
			socialLinks,
			projectWebpage,
			missionStatement,
			distributionStrategy
		);
	}

	/// @notice Adds stake to an existing member account.
	/// @param amount Additional G$ amount to stake.
	function stake(uint256 amount) external whenNotPaused {
		require(
			_goodDollar().transferFrom(msg.sender, address(this), amount),
			"G$ transferFrom"
		);
		_addStake(msg.sender, amount);
	}

	/// @notice Handles ERC677 transfers to stake or register members.
	/// @dev Empty `_data` stakes for an existing member; otherwise payload is decoded for registration.
	/// @param _from Original token sender.
	/// @param _amount Amount transferred.
	/// @param _data Encoded registration payload or empty bytes for plain staking.
	/// @return success True when transfer handling succeeds.
	function onTokenTransfer(
		address _from,
		uint256 _amount,
		bytes calldata _data
	) external override whenNotPaused returns (bool success) {
		require(msg.sender == address(_goodDollar()), "Only G$");

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
		) = abi.decode(_data, (House, string, string, string, string, string));
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

	/// @notice Approves a pending Alignment member once minimum stake is satisfied.
	/// @param account Member address to approve.
	function approveAlignmentMember(
		address account
	) external onlyRole(GOVERNANCE_COMMITTEE_ROLE) whenNotPaused {
		require(members[account].house == House.Alignment, "Not Alignment");
		require(members[account].status == MemberStatus.Pending, "Not pending");
		require(
			members[account].stakedAmount >= minimumStake[House.Alignment],
			"Stake < Alignment min"
		);

		members[account].status = MemberStatus.Active;
		members[account].updatedAt = uint64(block.timestamp);

		emit MemberApproved(account, members[account].house);
	}

	/// @notice Revokes an existing member.
	/// @param account Member address to revoke.
	function revokeMember(
		address account
	) external onlyRole(GOVERNANCE_COMMITTEE_ROLE) whenNotPaused {
		require(members[account].status != MemberStatus.None, "Not a member");
		members[account].status = MemberStatus.Revoked;
		members[account].updatedAt = uint64(block.timestamp);

		if (members[account].house == House.Alignment) {
			_clearMemberUnits(account);
		}
		emit MemberRevoked(account, members[account].house);
	}

	/// @notice Removes caller membership and returns all staked G$ after lock period.
	function unstake() external nonReentrant whenNotPaused {
		uint256 amount = members[msg.sender].stakedAmount;
		House house = members[msg.sender].house;
		uint memberIndex = members[msg.sender].memberIndex;
		// Require at least one full term since the last member update.
		require(
			block.timestamp >= members[msg.sender].updatedAt + termDuration,
			"Term not passed"
		);
		require(amount > 0, "No stake");
		// Remove member with swap-and-pop and rewrite moved member index.
		if (house == House.Alignment) {
			require(hoaMembers[memberIndex] == msg.sender, "Bad member index");
			hoaMembers[memberIndex] = hoaMembers[hoaMembers.length - 1];
			members[hoaMembers[memberIndex]].memberIndex = memberIndex;
			hoaMembers.pop();
		} else if (house == House.Citizens) {
			require(hocMembers[memberIndex] == msg.sender, "Bad member index");
			hocMembers[memberIndex] = hocMembers[hocMembers.length - 1];
			members[hocMembers[memberIndex]].memberIndex = memberIndex;
			hocMembers.pop();
		}

		delete members[msg.sender];

		if (house == House.Alignment) {
			_clearMemberUnits(msg.sender);
		}

		require(_goodDollar().transfer(msg.sender, amount), "G$ transfer");

		emit MemberUnstaked(msg.sender, house, amount);
	}

	// Returns the whitelisted identity root for a citizen account.
	function _getWhitelistedRoot(
		address account
	) internal view returns (address) {
		IIdentityV2 identity = IIdentityV2(nameService.getAddress("IDENTITY"));
		return identity.getWhitelistedRoot(account);
	}

	/// @notice Casts a weighted allocation vote in the current voting window.
	/// @param recipients Alignment member recipients included in this ballot.
	/// @param allocations Basis-point allocations per recipient, summing to 10,000.
	function castVote(
		address[] calldata recipients,
		uint256[] calldata allocations
	) external whenNotPaused {
		(uint256 voteId, uint64 voteStartTime) = _getCurrentVoteWindow();
		uint256 voterWeight = _getVoterWeight(msg.sender, voteStartTime);

		// Citizens vote by root identity so one identity can vote only once.
		House house = members[msg.sender].house;
		address voterRoot = house == House.Citizens
			? _getWhitelistedRoot(msg.sender)
			: msg.sender;

		require(
			members[msg.sender].stakedAmount >= minimumStake[house],
			"Stake < house min"
		);
		require(
			house == House.Alignment || voterRoot != address(0),
			"Citizen not whitelisted"
		);
		require(isVotingPeriod(), "Voting closed");
		require(voterWeight > 0, "Not eligible");

		if (votes[voteId].startTime == 0) {
			_createAlignmentVote(voteId, voteStartTime);
		}

		require(recipients.length == allocations.length, "Length mismatch");
		require(recipients.length > 0, "No recipients");

		require(!hasVoted[voteId][voterRoot], "Already voted");

		uint256 allocationTotal;
		for (uint256 i = 0; i < recipients.length; i++) {
			require(isVoteRecipient[voteId][recipients[i]], "Invalid recipient");
			allocationTotal += allocations[i];
		}
		// Enforce exact basis-point budget per ballot.
		require(allocationTotal == BASIS_POINTS, "Alloc != 10000");

		hasVoted[voteId][voterRoot] = true;

		// Accumulate weighted recipient totals for vote execution.
		for (uint256 i = 0; i < recipients.length; i++) {
			voteRecipientWeightedVotes[voteId][recipients[i]] +=
				(allocations[i] * voterWeight) /
				BASIS_POINTS;
		}

		emit VoteCast(voteId, msg.sender, recipients, allocations);
	}

	/// @notice Finalizes a completed vote and updates FlowSplitter units.
	/// @param voteId Vote identifier to execute.
	function executeVote(
		uint256 voteId
	) external onlyRole(GOVERNANCE_COMMITTEE_ROLE) whenNotPaused {
		VoteConfig storage vote = votes[voteId];
		FlowSplitterConfig memory flowConfig = flowSplitterConfig;
		address[] memory recipients = voteRecipients[voteId];
		uint256 count = recipients.length;
		IFlowSplitter.Member[] memory flowMembers = new IFlowSplitter.Member[](
			count
		);
		uint128[] memory weights = new uint128[](count);

		require(vote.startTime > 0, "Vote missing");
		require(block.timestamp > vote.endTime, "Vote still open");
		require(!vote.executed, "Vote executed");

		// Translate finalized weighted votes into FlowSplitter unit updates.
		for (uint256 i = 0; i < count; i++) {
			address recipient = recipients[i];
			uint128 units = uint128(voteRecipientWeightedVotes[voteId][recipient]);
			flowMembers[i] = IFlowSplitter.Member({
				account: recipient,
				units: units
			});
			weights[i] = units;
		}

		IFlowSplitter(flowConfig.splitter).updateMembersUnits(
			flowConfig.poolId,
			flowMembers
		);

		// Persist execution status to prevent re-execution.
		vote.executed = true;
		vote.executedAt = uint64(block.timestamp);

		emit VoteExecuted(
			voteId,
			flowConfig.poolId,
			flowConfig.poolAddress,
			recipients,
			weights
		);
	}

	/// @notice Configures the FlowSplitter pool used for distributing vote outcomes.
	/// @param splitter FlowSplitter contract address.
	/// @param poolId Pool identifier managed by this contract.
	function configureFlowSplitter(
		address splitter,
		uint256 poolId
	) external onlyRole(GOVERNANCE_COMMITTEE_ROLE) {
		require(splitter != address(0), "Splitter=0");
		require(poolId > 0, "PoolId=0");

		IFlowSplitter.Pool memory pool = IFlowSplitter(splitter).getPoolById(
			poolId
		);
		require(pool.poolAddress != address(0), "Pool missing");
		require(
			IFlowSplitter(splitter).isPoolAdmin(poolId, address(this)),
			"Not pool admin"
		);

		flowSplitterConfig.splitter = splitter;
		flowSplitterConfig.poolId = pool.id;
		flowSplitterConfig.poolAddress = pool.poolAddress;

		emit FlowSplitterConfigured(splitter, pool.id, pool.poolAddress);
	}

	/// @notice Pauses staking, voting and committee actions guarded by `whenNotPaused`.
	function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
		_pause();
	}

	/// @notice Unpauses contract operations guarded by `whenNotPaused`.
	function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
		_unpause();
	}

	/// @notice Returns the membership record for an account.
	/// @param account Member account to query.
	/// @return Member metadata and staking status.
	function getMember(
		address account
	) external view returns (MemberRecord memory) {
		return members[account];
	}

	/// @notice Returns active members in a paginated range for a house.
	/// @param house House to query.
	/// @param startIndex Inclusive start index in the house member list.
	/// @param endIndex Exclusive end index in the house member list.
	/// @return Active member accounts in the requested range.
	function getActiveMembers(
		House house,
		uint256 startIndex,
		uint256 endIndex
	) public view returns (address[] memory) {
		address[] memory memberAccounts = house == House.Alignment
			? hoaMembers
			: hocMembers;

		// Clamp end index to array length to avoid out-of-bounds reads.
		endIndex = endIndex > memberAccounts.length
			? memberAccounts.length
			: endIndex;

		// First pass counts active members to pre-size the return array.
		uint256 activeCount;
		for (uint256 i = startIndex; i < endIndex; i++) {
			if (members[memberAccounts[i]].status == MemberStatus.Active) {
				activeCount++;
			}
		}

		// Second pass writes active members into the exact-sized array.
		address[] memory activeMembers = new address[](activeCount);
		uint256 index;
		for (uint256 i = startIndex; i < endIndex; i++) {
			address account = memberAccounts[i];
			if (members[account].status == MemberStatus.Active) {
				activeMembers[index] = account;
				index++;
			}
		}

		return activeMembers;
	}

	/// @notice Returns all active members for a house.
	/// @param house House to query.
	/// @return Active member accounts for the entire house.
	function getActiveMembers(
		House house
	) external view returns (address[] memory) {
		return
			getActiveMembers(
				house,
				0,
				house == House.Alignment ? hoaMembers.length : hocMembers.length
			);
	}

	/// @notice Returns timing and execution metadata for a vote.
	/// @param voteId Vote identifier.
	/// @return Vote configuration data.
	function getVoteConfig(
		uint256 voteId
	) external view returns (VoteConfig memory) {
		return votes[voteId];
	}

	/// @notice Returns the recipient set for a vote.
	/// @param voteId Vote identifier.
	/// @return Recipient addresses snapshot used by the vote.
	function getVoteRecipients(
		uint256 voteId
	) external view returns (address[] memory) {
		return voteRecipients[voteId];
	}

	/// @notice Returns whether a voter identity has already voted in a vote.
	/// @param voteId Vote identifier.
	/// @param voter Voter identity key (address or citizen root).
	/// @return True if already voted.
	function getHasVoted(
		uint256 voteId,
		address voter
	) external view returns (bool) {
		return hasVoted[voteId][voter];
	}

	/// @notice Returns finalized weighted units for a vote recipient.
	/// @param voteId Vote identifier.
	/// @param recipient Recipient address.
	/// @return Final weighted units assigned to recipient.
	function getFinalizedUnits(
		uint256 voteId,
		address recipient
	) external view returns (uint128) {
		return uint128(voteRecipientWeightedVotes[voteId][recipient]);
	}

	/// @notice Returns the current vote id derived from the cycle schedule.
	/// @return Current vote identifier.
	function getCurrentVoteId() external view returns (uint256) {
		(uint256 voteId, ) = _getCurrentVoteWindow();
		return voteId;
	}

	// Registers or updates membership and persists profile metadata.
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
		require(uint8(house) <= uint8(House.Alignment), "Invalid house");
		bool isNewMember = members[account].status == MemberStatus.None;
		uint64 joinedAt = isNewMember
			? uint64(block.timestamp)
			: members[account].joinedAt;

		uint totalStake = members[account].stakedAmount + amount;
		require(totalStake >= minimumStake[house], "Stake < house min");
		require(
			isNewMember || members[account].house == house,
			"Cannot switch houses"
		);

		uint memberIndex = members[account].memberIndex;
		if (house == House.Alignment && isNewMember) {
			hoaMembers.push(account);
			memberIndex = hoaMembers.length - 1;
		} else if (house == House.Citizens && isNewMember) {
			hocMembers.push(account);
			memberIndex = hocMembers.length - 1;
		}
		MemberStatus status = isNewMember
			? house == House.Alignment ? MemberStatus.Pending : MemberStatus.Active
			: members[account].status;

		members[account] = MemberRecord({
			house: house,
			// Keep existing status on update; initialize by house-specific default.
			status: status,
			stakedAmount: totalStake,
			joinedAt: joinedAt,
			updatedAt: uint64(block.timestamp),
			unstakedAt: 0,
			memberIndex: memberIndex,
			name: name,
			socialLinks: socialLinks,
			projectWebpage: projectWebpage,
			missionStatement: missionStatement,
			distributionStrategy: distributionStrategy
		});

		emit MemberRegistered(account, house, status, totalStake);
	}

	// Adds stake to an existing member and refreshes activity timestamp.
	function _addStake(address account, uint256 amount) internal {
		require(members[account].status != MemberStatus.None, "not member");

		members[account].stakedAmount += amount;
		members[account].updatedAt = uint64(block.timestamp);

		emit MemberStaked(account, members[account].house, amount);
	}

	// Creates vote state and snapshots eligible Alignment recipients at vote start.
	function _createAlignmentVote(uint256 voteId, uint64 voteStartTime) internal {
		uint64 voteEndTime = voteStartTime + votingTermLength;

		votes[voteId].startTime = voteStartTime;
		votes[voteId].endTime = voteEndTime;

		for (uint256 i = 0; i < hoaMembers.length; i++) {
			address account = hoaMembers[i];
			if (
				members[account].status == MemberStatus.Active &&
				members[account].joinedAt <= voteStartTime
			) {
				voteRecipients[voteId].push(account);
				isVoteRecipient[voteId][account] = true;
			}
		}

		require(voteRecipients[voteId].length > 0, "No Alignment recipients");

		if (voteId > voteCount) {
			voteCount = voteId;
		}

		emit VoteCreated(
			voteId,
			voteStartTime,
			voteEndTime,
			voteRecipients[voteId]
		);
	}

	// Clears a member's flow units when splitter configuration is available.
	function _clearMemberUnits(address account) internal {
		if (
			flowSplitterConfig.splitter == address(0) ||
			flowSplitterConfig.poolId == 0
		) {
			return;
		}

		IFlowSplitter.Member[] memory flowmembers = new IFlowSplitter.Member[](1);
		flowmembers[0] = IFlowSplitter.Member({ account: account, units: 0 });
		IFlowSplitter(flowSplitterConfig.splitter).updateMembersUnits(
			flowSplitterConfig.poolId,
			flowmembers
		);
	}

	// Computes current vote id and aligned term start from cycle schedule.
	function _getCurrentVoteWindow()
		internal
		view
		returns (uint256 voteId, uint64 voteStartTime)
	{
		if (block.timestamp < cycleStartTime) {
			return (0, cycleStartTime);
		}

		uint256 elapsed = block.timestamp - cycleStartTime;
		voteId = elapsed / termDuration;
		voteStartTime = cycleStartTime + uint64(voteId * termDuration);
	}

	// Returns voting weight if member was active before the vote window opened.
	function _getVoterWeight(
		address voter,
		uint64 voteStartTime
	) internal view returns (uint256) {
		MemberRecord memory member = members[voter];
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

	/// @notice Returns whether the current timestamp is inside the voting window.
	/// @return True when timestamp falls within the modulo voting segment of the term.
	function isVotingPeriod() public view returns (bool) {
		uint timestamp = block.timestamp;
		if (timestamp < cycleStartTime) {
			return false;
		}

		// Voting is open for the first `votingTermLength` seconds of each term cycle.
		return ((timestamp - cycleStartTime) % termDuration) <= votingTermLength;
	}

	// Resolves the configured GoodDollar token from NameService.
	function _goodDollar() internal view returns (IGoodDollar) {
		return IGoodDollar(nameService.getAddress("GOODDOLLAR"));
	}
}
