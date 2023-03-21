// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";

// import "hardhat/console.sol";

/* @title Identity contract responsible for whitelisting
 * and keeping track of amount of whitelisted users
 */
contract IdentityV2 is
	DAOUpgradeableContract,
	AccessControlUpgradeable,
	PausableUpgradeable,
	EIP712Upgradeable
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
	string public constant TYPED_STRUCTURE =
		"ConnectIdentity(address whitelisted,address connected,uint256 deadline)";

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
		__EIP712_init_unchained("Identity", "1.0.0");
		authenticationPeriod = 365 * 3;
		_setupRole(DEFAULT_ADMIN_ROLE, avatar);
		_setupRole(DEFAULT_ADMIN_ROLE, _owner);
		_setupRole(PAUSER_ROLE, avatar);
		_setupRole(PAUSER_ROLE, _owner);
		_setupRole(IDENTITY_ADMIN_ROLE, _owner);
		_setupRole(IDENTITY_ADMIN_ROLE, avatar);

		oldIdentity = _oldIdentity;
	}

	/**
	 * @dev used to initialize after deployment once nameservice is available
	 */
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

	/**
	 * @dev Sets a new value for authenticationPeriod.
	 * Can only be called by Identity Administrators.
	 * @param period new value for authenticationPeriod
	 */
	function setAuthenticationPeriod(uint256 period) external whenNotPaused {
		_onlyAvatar();
		authenticationPeriod = period;
	}

	/**
	 * @dev Sets the authentication date of `account`
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

	/**
	 * @dev Adds an address as whitelisted.
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

	/**
	  @dev Adds an address as whitelisted under a specific ID
	  @param account The address to add
	  @param did the ID to add account under
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

	/**
	 * @dev Adds an address as whitelisted under a specific ID
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

	/**
	 * @dev Removes an address as whitelisted.
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

	/**
	 * @dev Renounces message sender from whitelisted
	 */
	function renounceWhitelisted() external whenNotPaused onlyWhitelisted {
		_removeWhitelisted(msg.sender);
	}

	/**
	 * @dev Returns true if given address has been added to whitelist
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

	/**
	 * @dev Function that gives the date the given user was added
	 * @param account The address to check
	 * @return The date the address was added
	 */
	function lastAuthenticated(address account) external view returns (uint256) {
		if (identities[account].dateAuthenticated > 0)
			return identities[account].dateAuthenticated;
		if (address(oldIdentity) != address(0)) {
			try oldIdentity.lastAuthenticated(account) returns (uint256 _lastAuth) {
				return _lastAuth;
			} catch {
				return 0;
			}
		}
		return 0;
	}

	/**
	 * @dev Adds an address to blacklist.
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

	/**
	 * @dev Removes an address from blacklist
	 * Can only be called by Identity Administrators.
	 * @param account address to remove as blacklisted
	 */
	function removeBlacklisted(address account)
		external
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		if (
			address(oldIdentity) != address(0) && oldIdentity.isBlacklisted(account)
		) oldIdentity.removeBlacklisted(account);

		identities[account].status = 0;
		emit BlacklistRemoved(account);
	}

	/**
	 * @dev Function to add a Contract to list of contracts
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

	/**
	 * @dev Function to remove a Contract from list of contracts
	 * @param account The address to add
	 */
	function removeContract(address account)
		public
		onlyRole(IDENTITY_ADMIN_ROLE)
		whenNotPaused
	{
		if (
			address(oldIdentity) != address(0) && oldIdentity.isDAOContract(account)
		) {
			oldIdentity.removeContract(account);
		}
		_removeWhitelisted(account);

		emit ContractRemoved(account);
	}

	/**
	 * @dev Function to check if given contract is on list of contracts.
	 * @param account to check
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

	/**
	 * @dev Internal function to add to whitelisted
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

	/**
	 * @dev Internal whitelisting with did function.
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

	/**
	 * @dev Internal function to remove from whitelisted
	 * @param account the address to add
	 */
	function _removeWhitelisted(address account) internal {
		if (identities[account].status == 1 || identities[account].status == 2) {
			whitelistedCount -= 1;

			if (isContract(account) && whitelistedContracts > 0) {
				whitelistedContracts -= 1;
			}

			string memory did = identities[account].did;
			bytes32 pHash = keccak256(bytes(did));

			delete identities[account];
			delete didHashToAddress[pHash];

			emit WhitelistedRemoved(account);
		}

		if (
			address(oldIdentity) != address(0) && oldIdentity.isWhitelisted(account)
		) {
			oldIdentity.removeWhitelisted(account);
		}
	}

	/// @notice helper function to get current chain id
	/// @return chainId id
	function _chainId() internal view returns (uint256 chainId) {
		assembly {
			chainId := chainid()
		}
	}

	/**
	 * @dev Returns true if given address has been added to the blacklist
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
		return false;
	}

	/**
	 * @dev Function to see if given address is a contract
	 * @return true if address is a contract
	 */
	function isContract(address _addr) internal view returns (bool) {
		uint256 length;
		assembly {
			length := extcodesize(_addr)
		}
		return length > 0;
	}

	/**
	 @dev allows user to connect more accounts to his identity. msg.sender needs to be whitelisted
	 @param account the account to connect to msg.sender
	 @param signature the eip712 signed typed data by _account see TYPED_STRUCTURE
	 @param blockDeadline the expiration block of the signature as specified in the typed data
	 */
	function connectAccount(
		address account,
		bytes memory signature,
		uint256 blockDeadline
	) external onlyWhitelisted {
		require(
			blockDeadline > 0 && blockDeadline >= block.number,
			"invalid deadline"
		);
		require(
			!isWhitelisted(account) && !isBlacklisted(account),
			"invalid account"
		);
		require(connectedAccounts[account] == address(0x0), "already connected");

		bytes32 digest = _hashTypedDataV4(
			keccak256(
				abi.encode(
					keccak256(bytes(TYPED_STRUCTURE)),
					msg.sender,
					account,
					blockDeadline
				)
			)
		);
		//signature ensures the whitelisted (msg.sender) has submited a signature by connected account
		//that connects both accounts
		require(
			SignatureCheckerUpgradeable.isValidSignatureNow(
				account,
				digest,
				signature
			),
			"invalid signature"
		);
		connectedAccounts[account] = msg.sender;
	}

	/**
	 @dev disconnect a connected account from identity. can be performed either by identity or the connected account
	 @param connected the account to disconnect
	 */
	function disconnectAccount(address connected) external {
		require(
			connectedAccounts[connected] == msg.sender || msg.sender == connected,
			"unauthorized"
		);
		delete connectedAccounts[connected];
	}

	/**
	 @dev returns the identity in case account is connected or is the identity itself otherwise returns the empty address
	 @param account address to get its identity
	 @return whitelisted the identity or address 0 if _account not connected or not identity
	 **/
	function getWhitelistedRoot(address account)
		external
		view
		returns (address whitelisted)
	{
		if (isWhitelisted(account)) return account;
		if (isWhitelisted(connectedAccounts[account]))
			return connectedAccounts[account];

		return address(0x0);
	}

	function pause(bool toPause) external onlyRole(PAUSER_ROLE) {
		if (toPause) _pause();
		else _unpause();
	}

	/**
	  @dev modify account did can be called by account owner or identity admin
	  @param account the account to modify
	  @param did the did to set
	 */
	function setDID(address account, string calldata did) external {
		require(
			msg.sender == account || hasRole(IDENTITY_ADMIN_ROLE, msg.sender),
			"not authorized"
		);
		_setDID(account, did);
	}

	function _setDID(address account, string memory did) internal {
		require(isWhitelisted(account), "not whitelisted");
		require(bytes(did).length > 0, "did empty");
		bytes32 pHash = keccak256(bytes(did));
		require(didHashToAddress[pHash] == address(0), "DID already registered");

		if (address(oldIdentity) != address(0)) {
			address oldDIDOwner;
			try oldIdentity.didHashToAddress(pHash) returns (address _didOwner) {
				oldDIDOwner = _didOwner;
			} catch {}
			//if owner not the same and doesnt have a new did set then revert
			require(
				oldDIDOwner == address(0) ||
					oldDIDOwner == account ||
					bytes(identities[oldDIDOwner].did).length > 0,
				"DID already registered oldIdentity"
			);
		}

		bytes32 oldHash = keccak256(bytes(identities[account].did));
		delete didHashToAddress[oldHash];
		identities[account].did = did;
		didHashToAddress[pHash] = account;
	}

	/**
	 @dev for backward compatability with V1
	 @param account to get DID for
	 @return did of the account
	 */
	function addrToDID(address account)
		external
		view
		returns (string memory did)
	{
		did = identities[account].did;
		bytes32 pHash = keccak256(bytes(did));

		//if did was set in this contract return it, otherwise check oldidentity
		if (didHashToAddress[pHash] == account) return did;

		if (address(oldIdentity) != address(0)) {
			try oldIdentity.addrToDID(account) returns (string memory _did) {
				return _did;
			} catch {
				return "";
			}
		}

		return "";
	}

	function getWhitelistedOnChainId(address account)
		external
		view
		returns (uint256 chainId)
	{
		chainId = identities[account].whitelistedOnChainId;
		return chainId > 0 ? chainId : _chainId();
	}

	/**
	 * backward compatability with IdentityV1 that GoodDollar token checks if the identity contract is registered
	 */
	function isRegistered() external pure returns (bool) {
		return true;
	}
}
