// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../Interfaces.sol";
import "../utils/NameService.sol";

/**
  @title Admin wallet contract allowing whitelisting and topping up of addresses
  @notice this is for Fuse with OwnableUpgradeable to keep storage layout
 */
contract AdminWalletFuse is
	Initializable,
	UUPSUpgradeable,
	OwnableUpgradeable,
	AccessControlUpgradeable
{
	bytes32 public constant WALLET_ADMIN_ROLE = keccak256("WALLET_ADMIN_ROLE");

	address payable[] adminlist;

	uint256 public toppingAmount;
	uint256 public adminToppingAmount;

	uint256 public toppingTimes;
	uint256 public gasPrice;

	NameService public nameService;

	mapping(uint256 => mapping(address => uint256)) toppings;

	uint64 public maxDailyNewWallets;
	uint64 public day;

	uint32 public version;

	event AdminsAdded(address payable[] indexed admins);
	event AdminsRemoved(address[] indexed admins);
	event WalletTopped(address indexed user, uint256 amount);
	event GenericCall(
		address indexed _contract,
		bytes _data,
		uint256 _value,
		bool _success
	);

	/**
	 * @dev initialize
	 */
	function initialize(
		address payable[] memory _admins,
		NameService _ns,
		address _owner,
		uint256 _gasPrice
	) public initializer {
		__AccessControl_init_unchained();
		__Ownable_init_unchained();

		_setupRole(DEFAULT_ADMIN_ROLE, _owner);

		_setDefaults(600000, 9e6, 3, _gasPrice);
		nameService = _ns;
		if (_admins.length > 0) {
			addAdmins(_admins);
		}
	}

	function upgrade(NameService _ns) public {
		require(version == 0, "already upgraded");
		version++;
		nameService = _ns;
	}

	function getIdentity() public view returns (IIdentityV2) {
		return IIdentityV2(nameService.getAddress("IDENTITY"));
	}

	function setDefaults(
		uint256 _toppingAmount,
		uint256 _adminToppingAmount,
		uint256 _toppingTimes,
		uint256 _gasPrice
	) external onlyOwner {
		_setDefaults(_toppingAmount, _adminToppingAmount, _toppingTimes, _gasPrice);
	}

	function _setDefaults(
		uint256 _toppingAmount,
		uint256 _adminToppingAmount,
		uint256 _toppingTimes,
		uint256 _gasPrice
	) internal {
		gasPrice = _gasPrice;
		toppingAmount = _toppingAmount * _gasPrice;
		adminToppingAmount = _adminToppingAmount * _gasPrice;
		toppingTimes = _toppingTimes;
	}

	function _authorizeUpgrade(address newImplementation)
		internal
		override
		onlyOwner
	{}

	/* @dev Modifier that checks if caller is admin of wallet
	 */
	modifier onlyAdmin() {
		require(isAdmin(msg.sender), "Caller is not admin");
		_;
	}

	modifier reimburseGas() {
		_;
		if (msg.sender.balance <= adminToppingAmount / 2 && isAdmin(msg.sender)) {
			_topWallet(payable(msg.sender));
		}
	}

	receive() external payable {}

	/* @dev Internal function that sets current day
	 */
	function currentDay() internal view returns (uint256) {
		return (block.timestamp / 1 days);
	}

	/* @dev Function to add list of addresses to admins
	 * can only be called by creator of contract
	 * @param _admins the list of addresses to add
	 */
	function addAdmins(address payable[] memory _admins) public onlyOwner {
		for (uint256 i = 0; i < _admins.length; i++) {
			if (isAdmin(_admins[i]) == false) {
				grantRole(WALLET_ADMIN_ROLE, _admins[i]);
				adminlist.push(_admins[i]);
			}
		}
		emit AdminsAdded(_admins);
	}

	/* @dev Function to remove list of addresses to admins
	 * can only be called by creator of contract
	 * @param _admins the list of addresses to remove
	 */
	function removeAdmins(address[] memory _admins) public onlyOwner {
		for (uint256 i = 0; i < _admins.length; i++) {
			revokeRole(WALLET_ADMIN_ROLE, _admins[i]);
		}
		emit AdminsRemoved(_admins);
	}

	/**
	 * @dev top admins
	 */
	function topAdmins(uint256 startIndex, uint256 endIndex) public reimburseGas {
		require(adminlist.length > startIndex, "Admin list is empty");
		for (uint256 i = startIndex; (i < adminlist.length && i < endIndex); i++) {
			if (
				isAdmin(adminlist[i]) && adminlist[i].balance <= adminToppingAmount / 2
			) {
				_topWallet(adminlist[i]);
			}
		}
	}

	/* @dev top the first 50 admins
	 */
	function topAdmins(uint256 startIndex) public reimburseGas {
		topAdmins(startIndex, startIndex + 50);
	}

	/**
	 * @dev Function to check if given address is an admin
	 * @param _user the address to check
	 * @return A bool indicating if user is an admin
	 */
	function isAdmin(address _user) public view returns (bool) {
		return hasRole(WALLET_ADMIN_ROLE, _user);
	}

	/* @dev Function to add given address to whitelist of identity contract
	 * can only be done by admins of wallet and if wallet is an IdentityAdmin
	 */
	function whitelist(address _user, string memory _did)
		public
		onlyAdmin
		reimburseGas
	{
		getIdentity().addWhitelistedWithDID(_user, _did);
	}

	/* @dev Function to add given address to whitelist of identity contract
	 * can only be done by admins of wallet and if wallet is an IdentityAdmin
	 */
	function whitelist(
		address _user,
		string memory _did,
		uint256 orgChain,
		uint256 dateAuthenticated
	) public onlyAdmin reimburseGas {
		getIdentity().addWhitelistedWithDIDAndChain(
			_user,
			_did,
			orgChain,
			dateAuthenticated
		);
	}

	/* @dev Function to remove given address from whitelist of identity contract
	 * can only be done by admins of wallet and if wallet is an IdentityAdmin
	 */
	function removeWhitelist(address _user) public onlyAdmin reimburseGas {
		getIdentity().removeWhitelisted(_user);
	}

	/* @dev Function to add given address to blacklist of identity contract
	 * can only be done by admins of wallet and if wallet is an IdentityAdmin
	 */
	function blacklist(address _user) public onlyAdmin reimburseGas {
		getIdentity().addBlacklisted(_user);
	}

	/* @dev Function to remove given address from blacklist of identity contract
	 * can only be done by admins of wallet and if wallet is an IdentityAdmin
	 */
	function removeBlacklist(address _user) public onlyAdmin reimburseGas {
		getIdentity().removeBlacklisted(_user);
	}

	/* @dev Function to top given address with amount of G$ given in constructor
	 * can only be done by admin the amount of times specified in constructor per day
	 * @param _user The address to transfer to
	 */
	function topWallet(address payable _user) public onlyAdmin reimburseGas {
		require(
			toppings[currentDay()][_user] < toppingTimes,
			"User wallet has been topped too many times today"
		);
		if (address(_user).balance >= toppingAmount / 4) return;

		_topWallet(_user);
	}

	function _topWallet(address payable _wallet) internal {
		toppings[currentDay()][_wallet] += 1;
		uint256 amount = isAdmin(_wallet) ? adminToppingAmount : toppingAmount;
		uint256 toTop = amount - address(_wallet).balance;
		_wallet.transfer(toTop);
		emit WalletTopped(_wallet, toTop);
	}

	/**
	 * @dev perform a generic call to an arbitrary contract
	 * @param _contract  the contract's address to call
	 * @param _data ABI-encoded contract call to call `_contract` address.
	 * @param _value value (ETH) to transfer with the transaction
	 * @return success    success or fail
	 *         bytes - the return bytes of the called contract's function.
	 */
	function genericCall(
		address _contract,
		bytes memory _data,
		uint256 _value
	)
		public
		onlyAdmin
		reimburseGas
		returns (bool success, bytes memory returnValue)
	{
		// solhint-disable-next-line avoid-call-value
		(success, returnValue) = _contract.call{ value: _value }(_data);
		emit GenericCall(_contract, _data, _value, success);
	}
}
