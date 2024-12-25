// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

/**
 * to be deployed on base to support superfluid airdrop to G$ users
 */
contract SuperfluidFaucet is
	Initializable,
	UUPSUpgradeable,
	AccessControlUpgradeable
{
	using SafeMathUpgradeable for uint256;

	bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

	uint256 public toppingAmount;
	uint256 public maxAmountPerPeriod;
	uint256 public toppingPeriod;

	struct RecipientInfo {
		uint256 lastWithdrawalPeriod;
		uint256 totalWithdrawnThisPeriod;
	}

	mapping(address => RecipientInfo) public recipientInfo;

	event WalletTopped(address recipient, uint256 amount);
	event SettingsUpdated(
		uint256 toppingAmount,
		uint256 maxAmountPerPeriod,
		uint256 toppingPeriod
	);

	/// @custom:oz-upgrades-unsafe-allow constructor
	constructor() {
		_disableInitializers();
	}

	function initialize(
		uint256 _toppingAmount,
		uint256 _maxAmountPerPeriod,
		uint256 _toppingPeriod,
		address _admin
	) public initializer {
		__AccessControl_init();
		__UUPSUpgradeable_init();

		_setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
		_setupRole(ADMIN_ROLE, msg.sender);
		_grantRole(ADMIN_ROLE, _admin);
		toppingAmount = _toppingAmount;
		maxAmountPerPeriod = _maxAmountPerPeriod;
		toppingPeriod = _toppingPeriod;
	}

	function updateSettings(
		uint256 _toppingAmount,
		uint256 _maxAmountPerPeriod,
		uint256 _toppingPeriod
	) external onlyRole(ADMIN_ROLE) {
		toppingAmount = _toppingAmount;
		maxAmountPerPeriod = _maxAmountPerPeriod;
		toppingPeriod = _toppingPeriod;
		emit SettingsUpdated(_toppingAmount, _maxAmountPerPeriod, _toppingPeriod);
	}

	function canTop(address recipient) public view returns (bool) {
		if (recipient == address(0)) return false;
		if (recipient.balance >= toppingAmount / 2) return false;

		uint256 amountToSend = toppingAmount.sub(recipient.balance);
		if (address(this).balance < amountToSend) return false;

		uint256 currentPeriod = block.timestamp / toppingPeriod;
		RecipientInfo storage info = recipientInfo[recipient];

		if (currentPeriod > info.lastWithdrawalPeriod) {
			return true; // New period, reset counters
		}

		if (info.totalWithdrawnThisPeriod.add(amountToSend) > maxAmountPerPeriod)
			return false;

		return true;
	}

	function topWallet(address payable recipient) external onlyRole(ADMIN_ROLE) {
		require(canTop(recipient), "Recipient cannot be topped up");

		uint256 currentPeriod = block.timestamp / toppingPeriod;
		RecipientInfo storage info = recipientInfo[recipient];

		if (currentPeriod > info.lastWithdrawalPeriod) {
			info.totalWithdrawnThisPeriod = 0;
			info.lastWithdrawalPeriod = currentPeriod;
		}

		uint256 amountToSend = toppingAmount.sub(recipient.balance);
		require(
			address(this).balance >= amountToSend,
			"Insufficient contract balance for topping up"
		);

		info.totalWithdrawnThisPeriod = info.totalWithdrawnThisPeriod.add(
			amountToSend
		);

		(bool success, ) = recipient.call{ value: amountToSend }("");
		require(success, "Failed to send Ether");

		emit WalletTopped(recipient, amountToSend);
	}

	receive() external payable {}

	function withdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
		uint256 balance = address(this).balance;
		payable(msg.sender).transfer(balance);
	}

	function _authorizeUpgrade(
		address newImplementation
	) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
