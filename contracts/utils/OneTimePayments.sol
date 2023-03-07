// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "../Interfaces.sol";
import "./DAOContract.sol";
import "../utils/NameService.sol";

/* @title One Time payment scheme
 * Scheme that allows address to deposit tokens for any address to withdraw
 */
contract OneTimePayments is DAOContract {
	struct Payment {
		bool hasPayment;
		uint256 paymentAmount;
		address paymentSender;
	}

	mapping(address => Payment) public payments;

	event PaymentDeposit(address indexed from, address paymentId, uint256 amount);
	event PaymentCancel(address indexed from, address paymentId, uint256 amount);
	event PaymentWithdraw(
		address indexed from,
		address indexed to,
		address indexed paymentId,
		uint256 amount
	);

	/* @dev Constructor
	 * @param _avatar The avatar of the DAO
	 * @param _identity The identity contract
	 * @param _gasLimit The gas limit
	 */
	constructor(INameService _ns) {
		setDAO(_ns);
	}

	/* @dev ERC677 on token transfer function. When transferAndCall is called on this contract,
	 * this function is called, depositing the payment amount under the hash of the given bytes.
	 * Reverts if hash is already in use. Can only be called by token contract.
	 * @param sender the address of the sender
	 * @param value the amount to deposit
	 * @param data The given paymentId which should be a fresh address of a wallet
	 */
	function onTokenTransfer(
		address sender,
		uint256 value,
		bytes calldata data
	) external returns (bool) {
		address paymentId = abi.decode(data, (address));

		require(!payments[paymentId].hasPayment, "paymentId already in use");
		require(msg.sender == address(nativeToken()), "Only callable by this");

		payments[paymentId] = Payment(true, value, sender);

		emit PaymentDeposit(sender, paymentId, value);

		return true;
	}

	/* @dev Withdrawal function.
	 * allows the sender that proves ownership of paymentId to withdraw
	 * @param paymentId the address of the public key that the
	 *   rightful receiver of the payment knows the private key to
	 * @param signature the signature of a the message containing the msg.sender address signed
	 *   with the private key.
	 */
	function withdraw(address paymentId, bytes memory signature) public {
		address signer = signerOfAddress(msg.sender, signature);
		require(signer == paymentId, "Signature is not correct");

		uint256 value = payments[paymentId].paymentAmount;
		address sender = payments[paymentId].paymentSender;

		_withdraw(paymentId, value);
		emit PaymentWithdraw(sender, msg.sender, paymentId, value);
	}

	/* @dev Cancel function
	 * allows only creator of payment to cancel
	 * @param paymentId The paymentId of the payment to cancelæ
	 */
	function cancel(address paymentId) public {
		require(
			payments[paymentId].paymentSender == msg.sender,
			"Can only be called by creator"
		);

		uint256 value = payments[paymentId].paymentAmount;

		_withdraw(paymentId, value);
		emit PaymentCancel(msg.sender, paymentId, value);
	}

	/* @dev Internal withdraw function
	 * @param paymentId the paymentId of the payment
	 * @param value the amopunt in the payment
	 */
	function _withdraw(address paymentId, uint256 value) internal {
		require(payments[paymentId].hasPayment, "paymentId not in use");

		payments[paymentId].hasPayment = false;

		require(
			nativeToken().transfer(msg.sender, value),
			"withdraw transfer failed"
		);
	}

	/* @dev function to check if a payment hash is in use
	 * @param paymentId the given paymentId
	 */
	function hasPayment(address paymentId) public view returns (bool) {
		return payments[paymentId].hasPayment;
	}

	/* @dev gives the signer address of the signature and the message
	 * @param message the plain-text message that is signed by the signature
	 * @param signature the signature of the plain-text message
	 */
	function signerOfAddress(address message, bytes memory signature)
		internal
		pure
		returns (address)
	{
		bytes32 signedMessage = ECDSA.toEthSignedMessageHash(
			keccak256(abi.encodePacked(message))
		);
		address signer = ECDSA.recover(signedMessage, signature);
		return signer;
	}
}
