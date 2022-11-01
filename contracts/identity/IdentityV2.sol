// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";

/* @title Identity contract responsible for whitelisting
 * and keeping track of amount of whitelisted users
 */
contract IdentityV2 is
	DAOUpgradeableContract,
	AccessControlUpgradeable,
	PausableUpgradeable
{
	struct Identity {
		uint256 dateAuthenticated;
		uint256 dateAdded;
		string did;
		uint256 whitelistedOnChainId;
		uint8 status; //0 nothing, 1 whitelisted, 2 daocontract, 255 blacklisted
	}

	bytes32 public constant IDENTITY_ADMIN_ROLE = keccak256("identity_admin");
	bytes32 public constant PAUSER_ROLE = keccak256("pause_admin");

	uint256 public whitelistedCount;
	uint256 public whitelistedContracts;
	uint256 public authenticationPeriod;

	mapping(address => Identity) public identities;

	mapping(bytes32 => address) public didHashToAddress;

	mapping(address => address) public connectedAccounts;

	IIdentity public oldIdentity;

	event BlacklistAdded(address indexed account);
	event BlacklistRemoved(address indexed account);

	event WhitelistedAdded(address indexed account);
	event WhitelistedRemoved(address indexed account);
	event WhitelistedAuthenticated(address indexed account, uint256 timestamp);

	event ContractAdded(address indexed account);
	event ContractRemoved(address indexed account);

	function initialize(address _owner, IIdentity _oldIdentity)
		public
		initializer
	{
		__AccessControl_init_unchained();
		__Pausable_init_unchained();
		authenticationPeriod = 365 * 3;
		_setupRole(DEFAULT_ADMIN_ROLE, avatar);
		_setupRole(DEFAULT_ADMIN_ROLE, _owner);
		_setupRole(PAUSER_ROLE, avatar);
		_setupRole(PAUSER_ROLE, _owner);
		_setupRole(IDENTITY_ADMIN_ROLE, _owner);
		_setupRole(IDENTITY_ADMIN_ROLE, avatar);

		oldIdentity = _oldIdentity;
	}

	function initDAO(address _ns) external onlyRole(DEFAULT_ADMIN_ROLE) {
		require(address(nameService) == address(0), "already initialized");
		setDAO(INameService(_ns));
		_setupRole(DEFAULT_ADMIN_ROLE, avatar);
		_setupRole(PAUSER_ROLE, avatar);
		_setupRole(IDENTITY_ADMIN_ROLE, avatar);
	}

	modifier onlyWhitelisted() {
		require(isWhitelisted(msg.sender), "not whitelisted");
		_;
	}

	/* @dev Sets a new value for authenticationPeriod.
	 * Can only be called by Identity Administrators.
	 * @param period new value for authenticationPeriod
	 */
	function setAuthenticationPeriod(uint256 period) external whenNotPaused {
		_onlyAvatar();
		authenticationPeriod = period;
	}

	/* @dev Sets the authentication date of `account`
	 * to the current time.
	 * Can only be called by Identity Administrators.
	 * @param account address to change its auth date
	 */
	function authenticate(address account)
		public
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		require(identities[account].status == 1, "not whitelisted");
		identities[account].dateAuthenticated = block.timestamp;
		emit WhitelistedAuthenticated(account, block.timestamp);
	}

	/* @dev Adds an address as whitelisted.
	 * Can only be called by Identity Administrators.
	 * @param account address to add as whitelisted
	 */
	function addWhitelisted(address account)
		public
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		_addWhitelisted(account, _chainId());
	}

	/* @dev Adds an address as whitelisted under a specific ID
	 * @param account The address to add
	 * @param did the ID to add account under
	 */
	function addWhitelistedWithDIDAndChain(
		address account,
		string memory did,
		uint256 orgChain,
		uint256 dateAuthenticated
	) external onlyRole(IDENTITY_ADMIN_ROLE) whenNotPaused {
		_addWhitelistedWithDID(account, did, orgChain);

		//in case we are whitelisting on a new chain an already whitelisted account, we need to make sure it expires at the same time
		if (dateAuthenticated > 0) {
			identities[account].dateAuthenticated = dateAuthenticated;
		}
	}

	/* @dev Adds an address as whitelisted under a specific ID
	 * @param account The address to add
	 * @param did the ID to add account under
	 */
	function addWhitelistedWithDID(address account, string memory did)
		public
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		_addWhitelistedWithDID(account, did, _chainId());
	}

	/* @dev Removes an address as whitelisted.
	 * Can only be called by Identity Administrators.
	 * @param account address to remove as whitelisted
	 */
	function removeWhitelisted(address account)
		public
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		_removeWhitelisted(account);
	}

	/* @dev Renounces message sender from whitelisted
	 */
	function renounceWhitelisted() external whenNotPaused onlyWhitelisted {
		_removeWhitelisted(msg.sender);
	}

	/* @dev Returns true if given address has been added to whitelist
	 * @param account the address to check
	 * @return a bool indicating weather the address is present in whitelist
	 */
	function isWhitelisted(address account) public view returns (bool) {
		uint256 daysSinceAuthentication = (block.timestamp -
			identities[account].dateAuthenticated) / 1 days;
		if (
			(daysSinceAuthentication <= authenticationPeriod) &&
			identities[account].status == 1
		) return true;

		if (address(oldIdentity) != address(0)) {
			try oldIdentity.isWhitelisted(account) returns (bool res) {
				return res;
			} catch {
				return false;
			}
		}
		return false;
	}

	/* @dev Function that gives the date the given user was added
	 * @param account The address to check
	 * @return The date the address was added
	 */
	function lastAuthenticated(address account) external view returns (uint256) {
		return identities[account].dateAuthenticated;
	}

	/* @dev Adds an address to blacklist.
	 * Can only be called by Identity Administrators.
	 * @param account address to add as blacklisted
	 */
	function addBlacklisted(address account)
		public
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		identities[account].status = 255;
		emit BlacklistAdded(account);
	}

	/* @dev Removes an address from blacklist
	 * Can only be called by Identity Administrators.
	 * @param account address to remove as blacklisted
	 */
	function removeBlacklisted(address account)
		external
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		if (address(oldIdentity) != address(0))
			try oldIdentity.removeBlacklisted(account) {} catch {}

		identities[account].status = 0;
		emit BlacklistRemoved(account);
	}

	/* @dev Function to add a Contract to list of contracts
	 * @param account The address to add
	 */
	function addContract(address account)
		public
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		require(isContract(account), "Given address is not a contract");
		_addWhitelisted(account, _chainId());
		identities[account].status = 2; //this must come after _addWhitelisted

		emit ContractAdded(account);
	}

	/* @dev Function to remove a Contract from list of contracts
	 * @param account The address to add
	 */
	function removeContract(address account)
		public
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		if (address(oldIdentity) != address(0)) {
			try oldIdentity.removeContract(account) {} catch {}
		}
		_removeWhitelisted(account);

		emit ContractRemoved(account);
	}

	/* @dev Function to check if given contract is on list of contracts.
	 * @param address to check
	 * @return a bool indicating if address is on list of contracts
	 */
	function isDAOContract(address account) external view returns (bool) {
		if (identities[account].status == 2) return true;
		if (address(oldIdentity) != address(0)) {
			try oldIdentity.isDAOContract(account) returns (bool res) {
				return res;
			} catch {
				return false;
			}
		}
		return false;
	}

	/* @dev Internal function to add to whitelisted
	 * @param account the address to add
	 */
	function _addWhitelisted(address account, uint256 orgChain) internal {
		require(identities[account].status == 0, "already has status");
		whitelistedCount += 1;
		identities[account].status = 1;
		identities[account].dateAdded = block.timestamp;
		identities[account].dateAuthenticated = block.timestamp;
		identities[account].whitelistedOnChainId = orgChain;
		connectedAccounts[account] = address(0);

		if (isContract(account)) {
			whitelistedContracts += 1;
		}

		emit WhitelistedAdded(account);
	}

	/* @dev Internal whitelisting with did function.
	 * @param account the address to add
	 * @param did the id to register account under
	 */
	function _addWhitelistedWithDID(
		address account,
		string memory did,
		uint256 orgChain
	) internal {
		bytes32 pHash = keccak256(bytes(did));
		require(didHashToAddress[pHash] == address(0), "DID already registered");

		identities[account].did = did;
		didHashToAddress[pHash] = account;

		_addWhitelisted(account, orgChain);
	}

	/* @dev Internal function to remove from whitelisted
	 * @param account the address to add
	 */
	function _removeWhitelisted(address account) internal {
		require(
			identities[account].status == 1 || identities[account].status == 2,
			"not whitelisted"
		);
		whitelistedCount -= 1;

		if (isContract(account)) {
			whitelistedContracts -= 1;
		}
		if (address(oldIdentity) != address(0)) {
			try oldIdentity.removeWhitelisted(account) {} catch {}
		}

		string memory did = identities[account].did;
		bytes32 pHash = keccak256(bytes(did));

		delete identities[account];
		delete didHashToAddress[pHash];

		emit WhitelistedRemoved(account);
	}

	/// @notice helper function to get current chain id
	/// @return chainId id
	function _chainId() internal view returns (uint256 chainId) {
		assembly {
			chainId := chainid()
		}
	}

	/* @dev Returns true if given address has been added to the blacklist
	 * @param account the address to check
	 * @return a bool indicating weather the address is present in the blacklist
	 */
	function isBlacklisted(address account) public view returns (bool) {
		if (identities[account].status == 255) return true;
		if (address(oldIdentity) != address(0)) {
			try oldIdentity.isBlacklisted(account) returns (bool res) {
				return res;
			} catch {
				return false;
			}
		}
	}

	/* @dev Function to see if given address is a contract
	 * @return true if address is a contract
	 */
	function isContract(address _addr) internal view returns (bool) {
		uint256 length;
		assembly {
			length := extcodesize(_addr)
		}
		return length > 0;
	}

	function connectAccount(address _account, bytes memory signature)
		external
		onlyWhitelisted
	{
		require(
			!isWhitelisted(_account) && !isBlacklisted(_account),
			"invalid account"
		);
		require(connectedAccounts[_account] == address(0x0), "already connected");
		//signature ensures the whitelisted (msg.sender) has submited a signature by connected account
		//that connects both accounts
		require(
			SignatureChecker.isValidSignatureNow(
				_account,
				keccak256(abi.encode(msg.sender, _account)),
				signature
			),
			"invalid signature"
		);
		connectedAccounts[_account] = msg.sender;
	}

	function getWhitelistedRoot(address _account)
		external
		view
		returns (address whitelisted)
	{
		if (isWhitelisted(_account)) return _account;
		if (isWhitelisted(connectedAccounts[_account]))
			return connectedAccounts[_account];

		return address(0x0);
	}

	function pause(bool _toPause) external onlyRole(PAUSER_ROLE) {
		if (_toPause) _pause();
		else _unpause();
	}

	function setDID(address account, string calldata did)
		external
		onlyRole(IDENTITY_ADMIN_ROLE)
	{
		_setDID(account, did);
	}

	function setDID(string calldata did) external {
		_setDID(msg.sender, did);
	}

	function _setDID(address account, string memory did) internal {
		require(isWhitelisted(account), "not whitelisted");
		bytes32 pHash = keccak256(bytes(did));
		require(didHashToAddress[pHash] == address(0), "DID already registered");

		bytes32 oldHash = keccak256(bytes(identities[msg.sender].did));
		delete didHashToAddress[oldHash];
		identities[msg.sender].did = did;
		didHashToAddress[pHash] = msg.sender;
	}

	function addrToDID(address account)
		external
		view
		returns (string memory did)
	{
		did = identities[msg.sender].did;
		if (bytes(did).length > 0) return did;
		try oldIdentity.addrToDID(account) returns (string memory _did) {
			return _did;
		} catch {
			return "";
		}
	}

	/**
	 * compatability with IdentityV1 that GoodDollar token checks if the identity contract is registered
	 */
	function isRegistered() external pure returns (bool) {
		return true;
	}
}
