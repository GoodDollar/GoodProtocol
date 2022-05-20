// SPDX-License-Identifier: MIT
/**
 Wrap the G$ token to provide mint permissions to multichain.org router/bridge
 based on https://github.com/anyswap/multichain-smart-contracts/blob/1459fe6281867319af8ffb1849e5c16d242d6530/contracts/wrapper/MintBurnWrapper.sol

 Added onTokenTransfer

 Fixed:
 https://github.com/anyswap/multichain-smart-contracts/issues/4
 https://github.com/anyswap/multichain-smart-contracts/issues/3
 */

pragma solidity ^0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../utils/DAOUpgradeableContract.sol";

contract DistributionHelper is
	DAOUpgradeableContract,
	AccessControlEnumerableUpgradeable
{
	enum TransferType {
		FuseBridge,
		MultichainBridge,
		Contract
	}

	struct DistributionRecipient {
		uint32 bps;
		uint32 chainId;
		address addr;
		TransferType transferType;
	}

	DistributionRecipient[] public distributionRecipients;
	address public fuseBridge;
	IMultichainRouter public multiChainBridge;

	event Distribution(
		uint256 distributed,
		uint256 startingBalance,
		uint256 incomingAmount
	);

	function initialize(INameService _ns) external initializer {
		__AccessControlEnumerable_init();
		setDAO(_ns);
		_setupRole(DEFAULT_ADMIN_ROLE, avatar);
		fuseBridge = nameService.getAddress("BRIDGE_CONTRACT");
		multiChainBridge = IMultichainRouter(
			0xf27Ee99622C3C9b264583dACB2cCE056e194494f
		);
	}

	function onDistribution(uint256 _amount) external {
		uint256 toDistribute = nativeToken().balanceOf(address(this));
		if (toDistribute == 0) return;

		uint256 totalDistributed;
		for (uint256 i = 0; i < distributionRecipients.length; i++) {
			DistributionRecipient storage r = distributionRecipients[i];
			if (r.bps > 0) {
				uint256 toTransfer = (toDistribute * r.bps) / 10000;
				totalDistributed += toTransfer;
				distribute(r, toTransfer);
			}
		}

		emit Distribution(totalDistributed, toDistribute, _amount);
	}

	function addRecipient(DistributionRecipient memory _recipient)
		external
		onlyRole(DEFAULT_ADMIN_ROLE)
	{
		distributionRecipients.push(_recipient);
	}

	function updateRecipient(DistributionRecipient memory _recipient)
		external
		onlyRole(DEFAULT_ADMIN_ROLE)
	{
		for (uint256 i = 0; i < distributionRecipients.length; i++) {
			if (distributionRecipients[i].addr == _recipient.addr) {
				distributionRecipients[i] = _recipient;
				return;
			}
		}
	}

	function distribute(DistributionRecipient storage _recipient, uint256 _amount)
		internal
	{
		if (_recipient.transferType == TransferType.FuseBridge) {
			nativeToken().transferAndCall(
				fuseBridge,
				_amount,
				abi.encodePacked(_recipient.addr)
			);
		} else if (_recipient.transferType == TransferType.MultichainBridge) {
			nativeToken().approve(address(multiChainBridge), _amount);
			multiChainBridge.anySwapOut(
				address(nativeToken()),
				_recipient.addr,
				_amount,
				_recipient.chainId
			);
		} else if (_recipient.transferType == TransferType.Contract) {
			nativeToken().transferAndCall(_recipient.addr, _amount, "");
		}
	}
}
