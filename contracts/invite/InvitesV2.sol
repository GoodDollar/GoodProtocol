// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../Interfaces.sol";
import "../utils/NameService.sol";
import "../utils/DAOUpgradeableContract.sol";

// import "hardhat/console.sol";

/**
 * @title InvitesV1 contract that handles invites with pre allocated bounty pool
 * 1.1 adds invitee bonus
 * 2 uses uups upgradeable - not compatible upgrade for v1
 */
contract InvitesV2 is DAOUpgradeableContract {
	struct Stats {
		uint256 totalApprovedInvites;
		uint256 totalBountiesPaid;
		uint256 totalInvited;
		uint256[5] __reserevedSpace;
	}

	struct User {
		address invitedBy;
		bytes32 inviteCode;
		bool bountyPaid;
		address[] invitees;
		address[] pending;
		uint256 level;
		uint256 levelStarted;
		uint256 totalApprovedInvites;
		uint256 totalEarned;
		uint256 joinedAt;
		uint256 bountyAtJoin;
		uint256[4] __reserevedSpace;
	}

	struct Level {
		uint256 toNext;
		uint256 bounty; //in G$ cents ie 2 decimals
		uint256 daysToComplete;
		uint256[5] __reserevedSpace;
	}

	mapping(bytes32 => address) public codeToUser;
	mapping(address => User) public users;

	mapping(uint256 => Level) public levels;

	address public owner;
	cERC20 public goodDollar;
	bool public active;
	Stats public stats;

	bool public levelExpirationEnabled;

	bytes32 private campaignCode;

	event InviteeJoined(address indexed inviter, address indexed invitee);
	event InviterBounty(
		address indexed inviter,
		address indexed invitee,
		uint256 bountyPaid,
		uint256 inviterLevel,
		bool earnedLevel
	);

	modifier ownerOrAvatar() {
		require(
			msg.sender == owner || msg.sender == avatar,
			"Only owner or avatar can perform this action"
		);
		_;
	}

	modifier isActive() {
		require(active, "not active");
		_;
	}

	function initialize(
		INameService _ns,
		uint256 _level0Bounty,
		address _owner
	) public initializer {
		__init_invites(_ns, _level0Bounty, _owner);
	}

	function __init_invites(
		INameService _ns,
		uint256 _level0Bounty,
		address _owner
	) internal virtual {
		setDAO(_ns);
		owner = _owner;
		active = true;
		Level storage lvl = levels[0];
		lvl.bounty = _level0Bounty;
		goodDollar = cERC20(nameService.getAddress("GOODDOLLAR"));
		levelExpirationEnabled = false;
	}

	function _authorizeUpgrade(
		address newImplementation
	) internal override ownerOrAvatar {}

	function getIdentity() public view returns (IIdentityV2) {
		return IIdentityV2(nameService.getAddress("IDENTITY"));
	}

	function setLevelExpirationEnabled(bool _isEnabled) public ownerOrAvatar {
		levelExpirationEnabled = _isEnabled;
	}

	function join(bytes32 _myCode, bytes32 _inviterCode) public isActive {
		require(
			codeToUser[_myCode] == address(0) ||
				codeToUser[_myCode] == msg.sender ||
				address(uint160(uint256(_myCode))) == msg.sender,
			"invite code already in use"
		);
		require(_myCode != _inviterCode, "self invite");
		User storage user = users[msg.sender]; // this is not expensive as user is new
		address inviter = codeToUser[_inviterCode];
		//allow user to set inviter if doesnt have one
		require(
			!user.bountyPaid &&
				(user.inviteCode == 0x0 ||
					(user.invitedBy == address(0) && inviter != address(0)) ||
					(campaignCode != 0x0 && campaignCode == _inviterCode)),
			"user already joined"
		);
		if (user.inviteCode == 0x0) {
			user.inviteCode = _myCode;
			user.levelStarted = block.timestamp;
			user.joinedAt = block.timestamp;
			codeToUser[_myCode] = msg.sender;
		}
		if (inviter != address(0)) {
			require(inviter != msg.sender, "self invite");
			user.invitedBy = inviter;
			users[inviter].invitees.push(msg.sender);
			users[inviter].pending.push(msg.sender);
			stats.totalInvited += 1;
			user.bountyAtJoin = levels[users[inviter].level].bounty;
		}

		/** support special campaign code without inviter */
		if (_inviterCode == campaignCode && campaignCode != 0x0) {
			user.bountyAtJoin = levels[0].bounty;
		}

		if (canCollectBountyFor(msg.sender)) {
			_bountyFor(msg.sender, true);
		}
		emit InviteeJoined(inviter, msg.sender);
	}

	function _whitelistedOnChainOrDefault(
		address _invitee
	) internal view returns (uint256 chainId) {
		(bool success, bytes memory result) = address(getIdentity()).staticcall(
			abi.encodeWithSignature("getWhitelistedOnChainId(address)", _invitee)
		);
		if (success == false) {
			return _chainId();
		}

		return abi.decode(result, (uint256));
	}

	function canCollectBountyFor(address _invitee) public view returns (bool) {
		address invitedBy = users[_invitee].invitedBy;

		return
			users[_invitee].bountyAtJoin > 0 &&
			!users[_invitee].bountyPaid &&
			getIdentity().isWhitelisted(_invitee) &&
			(invitedBy == address(0) || getIdentity().isWhitelisted(invitedBy)) &&
			_whitelistedOnChainOrDefault(_invitee) == _chainId();
	}

	function getInvitees(
		address _inviter
	) public view returns (address[] memory) {
		return users[_inviter].invitees;
	}

	function getPendingInvitees(
		address _inviter
	) public view returns (address[] memory) {
		address[] memory pending = users[_inviter].pending;
		uint256 cur = 0;
		uint256 total = 0;
		for (uint256 i; i < pending.length; i++) {
			if (!users[pending[i]].bountyPaid) {
				total++;
			}
		}

		address[] memory result = new address[](total);

		for (uint256 i; i < pending.length; i++) {
			if (!users[pending[i]].bountyPaid) {
				result[cur] = pending[i];
				cur++;
			}
		}

		return result;
	}

	function getPendingBounties(address _inviter) public view returns (uint256) {
		address[] memory pending = users[_inviter].pending;
		uint256 total = 0;
		for (uint256 i; i < pending.length; i++) {
			if (canCollectBountyFor(pending[i])) {
				total++;
			}
		}
		return total;
	}

	/**
	 * @dev  pay bounty for the inviter of _invitee
	 * invitee need to be whitelisted
	 */
	function bountyFor(
		address _invitee
	) public isActive returns (uint256 bounty) {
		require(canCollectBountyFor(_invitee), "user not elligble for bounty yet");
		return _bountyFor(_invitee, true);
	}

	function _bountyFor(
		address _invitee,
		bool isSingleBounty
	) internal returns (uint256 bounty) {
		address invitedBy = users[_invitee].invitedBy;
		uint256 bountyToPay = users[_invitee].bountyAtJoin;
		bool earnedLevel = false;

		if (invitedBy != address(0)) {
			uint256 joinedAt = users[_invitee].joinedAt;
			Level memory level = levels[users[invitedBy].level];

			//hardcoded for users invited before the bountyAtJoin change
			if (bountyToPay == 0) {
				uint precision = 10 ** goodDollar.decimals();
				bountyToPay = joinedAt > 1687878272
					? 1000 * precision
					: 500 * precision;
			}

			// if inviter level is now higher than when invitee joined or the base level has changed
			// we give level bounty if it is higher otherwise the original bounty at the time the user registered

			bountyToPay = level.bounty > bountyToPay ? level.bounty : bountyToPay;

			bool isLevelExpired = level.daysToComplete > 0 &&
				joinedAt > users[invitedBy].levelStarted && //prevent overflow in subtraction
				level.daysToComplete <
				(joinedAt - users[invitedBy].levelStarted) / 1 days; //how long after level started did invitee join

			users[invitedBy].totalApprovedInvites += 1;
			users[invitedBy].totalEarned += bountyToPay;

			if (
				level.toNext > 0 &&
				users[invitedBy].totalApprovedInvites >= level.toNext &&
				isLevelExpired == false
			) {
				users[invitedBy].level += 1;
				users[invitedBy].levelStarted = block.timestamp;
				earnedLevel = true;
			}

			if (isSingleBounty) goodDollar.transfer(invitedBy, bountyToPay);
		}

		users[_invitee].bountyPaid = true;
		stats.totalApprovedInvites += 1;
		stats.totalBountiesPaid += bountyToPay;

		goodDollar.transfer(_invitee, bountyToPay / 2); //pay invitee half the bounty
		emit InviterBounty(
			invitedBy,
			_invitee,
			bountyToPay,
			users[invitedBy].level,
			earnedLevel
		);

		return bountyToPay;
	}

	/**
     @dev collect bounties for invitees by msg.sender that are now whitelisted
     */
	function collectBounties() public isActive {
		address[] storage pendings = users[msg.sender].pending;
		uint256 totalBounties = 0;
		for (uint256 i = pendings.length; i > 0; i--) {
			if (gasleft() < 185000) break; // leave enough gas for the inviter transfer around 150k each if we are using supertoken
			address pending = pendings[i - 1];
			if (canCollectBountyFor(pending)) {
				if (gasleft() < 300000) break; // leave enough gas for the invitee+inviter transfer around 150k each if we are using supertoken
				totalBounties += _bountyFor(pending, false);
				pendings[i - 1] = pendings[pendings.length - 1];
				pendings.pop();
			}
		}
		if (totalBounties > 0) goodDollar.transfer(msg.sender, totalBounties);
	}

	function setLevel(
		uint256 _lvl,
		uint256 _toNext,
		uint256 _bounty,
		uint256 _daysToComplete
	) public ownerOrAvatar {
		Level storage lvl = levels[_lvl];
		lvl.toNext = _toNext;
		lvl.daysToComplete = _daysToComplete;
		lvl.bounty = _bounty;
	}

	function setActive(bool _active) public ownerOrAvatar {
		active = _active;
	}

	function setCampaignCode(bytes32 _code) public ownerOrAvatar {
		campaignCode = _code;
	}

	function end() public ownerOrAvatar isActive {
		uint256 gdBalance = goodDollar.balanceOf(address(this));
		goodDollar.transfer(msg.sender, gdBalance);
		payable(msg.sender).transfer(address(this).balance);
		active = false;
	}

	/// @notice helper function to get current chain id
	/// @return chainId id
	function _chainId() internal view returns (uint256 chainId) {
		assembly {
			chainId := chainid()
		}
	}

	/**
	 * @dev
	 * 1.2.0 - final changes before release
	 * 1.3.0 - allow to set inviter later
	 * 1.4.0 - improve gas for bounty collection
	 * 1.5.0 - more gas improvements
	 * 2 uses uups upgradeable - not compatible upgrade for v1
	 * 2.1 prevent multichain claims
	 * 2.2 record bounty at join time
	 * 2.3 support campaignCode
	 */
	function version() public pure returns (string memory) {
		return "2.3";
	}
}
