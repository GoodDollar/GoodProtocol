// SPDX-License-Identifier: MIT

pragma solidity >0.5.4;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./FeeFormula.sol";
import "../utils/DAOContract.sol";
import "../utils/NameService.sol";

import "./ERC677/ERC677BridgeToken.sol";

/**
 * @title The GoodDollar ERC677 token contract
 */
contract GoodDollar is Initializable, DAOContract, ERC677BridgeToken {
	using SafeMathUpgradeable for uint256;

	//TODO: read from nameService
	address feeRecipient;

	//TODO: read from nameService
	IAbstractFees formula;

	uint256 public cap;

	// /**
	//  * @dev constructor
	//  * @param _name The name of the token
	//  * @param _symbol The symbol of the token
	//  * @param _cap the cap of the token. no cap if 0
	//  * @param _formula the fee formula contract
	//  * @param _identity the identity contract
	//  * @param _feeRecipient the address that receives transaction fees
	//  */
	// constructor(
	// 	string memory _name,
	// 	string memory _symbol,
	// 	uint256 _cap,
	// 	AbstractFees _formula,
	// 	Identity _identity,
	// 	address _feeRecipient
	// )
	// 	public
	// 	ERC677BridgeToken(_name, _symbol, _cap)
	// 	IdentityGuard(_identity)
	// 	FormulaHolder(_formula)
	// {
	// 	feeRecipient = _feeRecipient;
	// }

	function initialize(
		string memory _name,
		string memory _symbol,
		uint256 _cap,
		NameService _ns
	) public initializer {
		__ERC677BridgeToken_init(_name, _symbol);
		setDAO(_ns);
		cap = _cap;
	}

	function decimals() public pure override returns (uint8) {
		return 2;
	}

	/**
	 * @dev enforce processes fees on every transfer.
	 * @param from the sender address
	 * @param to the address to be sent to
	 * @param value the value to be processed and then
	 * transferred
	 */

	function _transfer(
		address from,
		address to,
		uint256 value
	) internal override {
		uint256 bruttoValue = processFees(from, to, value);
		return super._transfer(from, to, bruttoValue);
	}

	/**
	 * @dev Gets the current transaction fees
	 * @return an uint256 that represents
	 * the current transaction fees
	 */
	function getFees(uint256 value) public view returns (uint256, bool) {
		return formula.getTxFees(value, address(0), address(0));
	}

	/**
	 * @dev Gets the current transaction fees
	 * @return an uint256 that represents
	 * the current transaction fees
	 */
	function getFees(
		uint256 value,
		address sender,
		address recipient
	) public view returns (uint256, bool) {
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
	function processFees(
		address account,
		address recipient,
		uint256 value
	) internal returns (uint256) {
		(uint256 txFees, bool senderPays) = getFees(value, account, recipient);
		//TODO: find alternative for identity.isDAOContract, nameservice?
		// if (txFees > 0 && !identity.isDAOContract(msg.sender)) {
		if (txFees > 0) {
			require(
				senderPays == false || value.add(txFees) <= balanceOf(account),
				"Not enough balance to pay TX fee"
			);
			if (account == msg.sender) {
				super.transfer(feeRecipient, txFees);
			} else {
				super.transferFrom(account, feeRecipient, txFees);
			}

			return senderPays ? value : value.sub(txFees);
		}
		return value;
	}

	/**
	 * @dev See {ERC20-_beforeTokenTransfer}.
	 * enforce the cap
	 * Requirements:
	 *
	 * - minted tokens must not cause the total supply to go over the cap.
	 */
	function _beforeTokenTransfer(
		address from,
		address to,
		uint256 amount
	) internal virtual override {
		super._beforeTokenTransfer(from, to, amount);

		if (from == address(0)) {
			// When minting tokens
			require(
				totalSupply().add(amount) <= cap,
				"ERC20Capped: cap exceeded"
			);
		}
	}
}
