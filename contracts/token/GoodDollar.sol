// SPDX-License-Identifier: MIT

pragma solidity >=0.8;
import "./ERC677.sol";
import "./FeesFormula.sol";
import "../Interfaces.sol";
import "./ERC20PresetMinterPauserUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title The GoodDollar V2 ERC677 token contract
 */

contract GoodDollar is
	UUPSUpgradeable,
	ERC677,
	ERC20PresetMinterPauserUpgradeable
{
	address public feeRecipient;

	IFeesFormula public formula;

	IIdentity public identity;

	uint256 public cap;

	/**
	 * @dev constructor
	 * @param _name The name of the token
	 * @param _symbol The symbol of the token
	 * @param _cap the cap of the token. no cap if 0
	 * @param _formula the fee formula contract
	 * @param _identity the identity contract
	 * @param _feeRecipient the address that receives transaction fees
	 */
	function initialize(
		string memory _name,
		string memory _symbol,
		uint256 _cap,
		IFeesFormula _formula,
		IIdentity _identity,
		address _feeRecipient,
		address _owner
	) public initializer {
		__ERC20PresetMinterPauser_init(_name, _symbol);
		feeRecipient = _feeRecipient;
		identity = _identity;
		formula = _formula;
		cap = _cap;
		if (_owner != _msgSender()) {
			transferOwnership(_owner);
			renounceRole(MINTER_ROLE, _msgSender());
			renounceRole(PAUSER_ROLE, _msgSender());
		}
	}

	modifier onlyOwner() {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "not owner");
		_;
	}

	function _authorizeUpgrade(address newImplementation)
		internal
		override
		onlyOwner
	{}

	function decimals() public view virtual override returns (uint8) {
		return 2;
	}

	function setFormula(IFeesFormula _formula) external onlyOwner {
		formula = _formula;
	}

	function setIdentity(IIdentityV2 _identity) external onlyOwner {
		identity = _identity;
	}

	function transferOwnership(address _owner) public onlyOwner {
		grantRole(DEFAULT_ADMIN_ROLE, _owner);
		renounceRole(DEFAULT_ADMIN_ROLE, _msgSender());
	}

	function owner() external view returns (address) {
		return getRoleMember(DEFAULT_ADMIN_ROLE, 0);
	}

	function isMinter(address _minter) external view returns (bool) {
		return hasRole(MINTER_ROLE, _minter);
	}

	function addMinter(address _minter) external {
		grantRole(MINTER_ROLE, _minter);
	}

	function renounceMinter() external {
		renounceRole(MINTER_ROLE, _msgSender());
	}

	function addPauser(address _pauser) external {
		grantRole(PAUSER_ROLE, _pauser);
	}

	function isPauser(address _pauser) external view returns (bool) {
		return hasRole(PAUSER_ROLE, _pauser);
	}

	/**
	 * @dev Processes fees from given value and sends
	 * remainder to given address
	 * @param to the address to be sent to
	 * @param value the value to be processed and then
	 * transferred
	 * @return a boolean that indicates if the operation was successful
	 */
	function transfer(address to, uint256 value)
		public
		override(ERC20Upgradeable, ERC677)
		returns (bool)
	{
		uint256 bruttoValue = _processFees(msg.sender, to, value);
		return ERC20Upgradeable.transfer(to, bruttoValue);
	}

	/**
	 * @dev Transfer tokens from one address to another
	 * @param from The address which you want to send tokens from
	 * @param to The address which you want to transfer to
	 * @param value the amount of tokens to be transferred
	 * @return a boolean that indicates if the operation was successful
	 */
	function transferFrom(
		address from,
		address to,
		uint256 value
	) public override returns (bool) {
		uint256 bruttoValue = _processFees(from, to, value);
		return super.transferFrom(from, to, bruttoValue);
	}

	/**
	 * @dev Processes transfer fees and calls ERC677Token transferAndCall function
	 * @param to address to transfer to
	 * @param value the amount to transfer
	 * @param data The data to pass to transferAndCall
	 * @return a bool indicating if transfer function succeeded
	 */
	function transferAndCall(
		address to,
		uint256 value,
		bytes calldata data
	) external returns (bool) {
		uint256 bruttoValue = _processFees(msg.sender, to, value);
		bool res = ERC20Upgradeable.transfer(to, bruttoValue);
		emit Transfer(msg.sender, to, bruttoValue, data);

		if (isContract(to)) {
			require(
				contractFallback(to, bruttoValue, data),
				"Contract fallback failed"
			);
		}
		return res;
	}

	/**
	 * @dev Minting function
	 * @param to the address that will receive the minted tokens
	 * @param value the amount of tokens to mint
	 */
	function mint(address to, uint256 value) public override returns (bool) {
		if (cap > 0) {
			require(
				totalSupply() + value <= cap,
				"Cannot increase supply beyond cap"
			);
		}
		return super.mint(to, value);
	}

	/**
	 * @dev Gets the current transaction fees
	 * @return fee senderPays  that represents the current transaction fees and bool true if sender pays the fee or receiver
	 */
	function getFees(uint256 value)
		public
		view
		returns (uint256 fee, bool senderPays)
	{
		return formula.getTxFees(value, address(0), address(0));
	}

	/**
	 * @dev Gets the current transaction fees
	 * @return fee senderPays  that represents the current transaction fees and bool true if sender pays the fee or receiver
	 */
	function getFees(
		uint256 value,
		address sender,
		address recipient
	) public view returns (uint256 fee, bool senderPays) {
		return formula.getTxFees(value, sender, recipient);
	}

	/**
	 * @dev Sets the address that receives the transactional fees.
	 * can only be called by owner
	 * @param _feeRecipient The new address to receive transactional fees
	 */
	function setFeeRecipient(address _feeRecipient) public onlyOwner {
		feeRecipient = _feeRecipient;
	}

	/**
	 * @dev Sends transactional fees to feeRecipient address from given address
	 * @param account The account that sends the fees
	 * @param value The amount to subtract fees from
	 * @return an uint256 that represents the given value minus the transactional fees
	 */
	function _processFees(
		address account,
		address recipient,
		uint256 value
	) internal returns (uint256) {
		(uint256 txFees, bool senderPays) = getFees(value, account, recipient);
		if (txFees > 0 && !identity.isDAOContract(msg.sender)) {
			require(
				senderPays == false || value + txFees <= balanceOf(account),
				"Not enough balance to pay TX fee"
			);
			if (account == msg.sender) {
				super.transfer(feeRecipient, txFees);
			} else {
				super.transferFrom(account, feeRecipient, txFees);
			}

			return senderPays ? value : value - txFees;
		}
		return value;
	}
}
