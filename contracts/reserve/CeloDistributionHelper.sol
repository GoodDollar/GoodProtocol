// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@mean-finance/uniswap-v3-oracle/solidity/interfaces/IStaticOracle.sol";
import "@gooddollar/bridge-contracts/contracts/messagePassingBridge/IMessagePassingBridge.sol";

import "../utils/DAOUpgradeableContract.sol";

// import "hardhat/console.sol";

/***
 * @dev DistributionHelper receives funds and distributes them to recipients
 * recipients can be on other blockchains and get their funds via fuse/multichain bridge
 * accounts with ADMIN_ROLE can update the recipients, defaults to Avatar
 */
contract CeloDistributionHelper is
	DAOUpgradeableContract,
	AccessControlEnumerableUpgradeable
{
	error FEE_LIMIT(uint256 fee);
	error INVALID_CHAINID();

	bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

	address public constant CELO = 0x471EcE3750Da237f93B8E339c536989b8978a438;

	address public constant CUSD = 0x765DE816845861e75A25fCA122bb6898B8B1282a;

	ISwapRouter public constant ROUTER =
		ISwapRouter(0x5615CDAb10dc425a742d643d949a7F474C01abc4);

	enum TransferType {
		LayerZeroBridge,
		Transfer,
		TransferAndCall
	}

	struct DistributionRecipient {
		uint32 bps; //share out of each distribution
		uint32 chainId; //for multichain bridge
		address addr; //recipient address
		TransferType transferType;
	}

	struct FeeSettings {
		uint128 maxFee;
		uint128 minBalanceForFees;
		uint8 percentageToSellForFee;
		uint8 maxSlippage;
	}

	DistributionRecipient[] public distributionRecipients;

	IMessagePassingBridge public mpbBridge;
	FeeSettings public feeSettings; //previously anyGoodDollar_unused; //kept for storage layout upgrades
	IStaticOracle public STATIC_ORACLE;

	event Distribution(
		uint256 distributed,
		uint256 startingBalance,
		uint256 incomingAmount,
		DistributionRecipient[] distributionRecipients,
		uint256 gdSoldForGas,
		uint256 nativeBoughtForGas
	);
	event RecipientUpdated(DistributionRecipient recipient, uint256 index);
	event RecipientAdded(DistributionRecipient recipient, uint256 index);

	receive() external payable {}

	function initialize(
		INameService _ns,
		IStaticOracle _oracle
	) external initializer {
		__AccessControlEnumerable_init();
		setDAO(_ns);
		_setupRole(DEFAULT_ADMIN_ROLE, avatar); //this needs to happen after setDAO for avatar to be non empty
		_setupRole(GUARDIAN_ROLE, avatar);
		mpbBridge = IMessagePassingBridge(
			nameService.getAddress("MPBBRIDGE_CONTRACT")
		);
		STATIC_ORACLE = _oracle;
		uint24[] memory fees = new uint24[](1);
		fees[0] = 10000;
		STATIC_ORACLE.prepareSpecificFeeTiersWithTimePeriod(
			CUSD,
			address(nativeToken()),
			fees,
			60
		);
		fees[0] = 100;
		STATIC_ORACLE.prepareSpecificFeeTiersWithTimePeriod(CUSD, CELO, fees, 60);
	}

	function setFeeSettings(
		FeeSettings memory _feeData
	) external onlyRole(GUARDIAN_ROLE) {
		feeSettings = _feeData;
	}

	/**
	 * @notice this is usually called by reserve, but can be called by anyone anytime to trigger distribution
	 * @param _amount how much was sent, informational only
	 */
	function onDistribution(uint256 _amount) external virtual {
		//we consider the actual balance and not _amount
		// console.log("onDistribution amount: %s", _amount);
		uint256 toDistribute = nativeToken().balanceOf(address(this));
		if (toDistribute == 0) return;

		uint256 boughtNative;
		uint256 gdToSellForFee;
		uint256 minReceived;
		if (address(this).balance < feeSettings.minBalanceForFees) {
			gdToSellForFee =
				(toDistribute * feeSettings.percentageToSellForFee) /
				100;
			(gdToSellForFee, minReceived) = calcGDToSell(gdToSellForFee);
			toDistribute -= gdToSellForFee;
			boughtNative = buyNativeWithGD(gdToSellForFee, minReceived);
			// console.log("bought: %s", boughtNative, "minReceived:", minReceived);
			// console.log("balance:", ERC20(nativeToken()).balanceOf(address(this)));
		}

		uint256 totalDistributed;
		for (uint256 i = 0; i < distributionRecipients.length; i++) {
			DistributionRecipient storage r = distributionRecipients[i];
			if (r.bps > 0) {
				uint256 toTransfer = (toDistribute * r.bps) / 10000;
				totalDistributed += toTransfer;
				if (toTransfer > 0) distribute(r, toTransfer);
			}
		}

		emit Distribution(
			totalDistributed,
			toDistribute,
			_amount,
			distributionRecipients,
			gdToSellForFee,
			boughtNative
		);
	}

	/**
	 * @notice add or update a recipient details, if address exists it will update, otherwise add
	 * to "remove" set recipient bps to 0. only ADMIN_ROLE can call this.
	 */
	function addOrUpdateRecipient(
		DistributionRecipient memory _recipient
	) external onlyRole(DEFAULT_ADMIN_ROLE) {
		if (
			_recipient.transferType != TransferType.LayerZeroBridge &&
			_recipient.chainId != block.chainid
		) {
			revert INVALID_CHAINID();
		}

		for (uint256 i = 0; i < distributionRecipients.length; i++) {
			if (distributionRecipients[i].addr == _recipient.addr) {
				distributionRecipients[i] = _recipient;
				emit RecipientUpdated(_recipient, i);
				return;
			}
		}
		//if reached here then add new one
		emit RecipientAdded(_recipient, distributionRecipients.length);
		distributionRecipients.push(_recipient);
	}

	/**
	 * @notice internal function that takes care of sending the G$s according to the transfer type
	 * @param _recipient data about the recipient
	 * @param _amount how much to send
	 */
	function distribute(
		DistributionRecipient storage _recipient,
		uint256 _amount
	) internal {
		// console.log("distributing to: %s %s", _recipient.addr, _amount);
		if (_recipient.transferType == TransferType.LayerZeroBridge) {
			nativeToken().approve(address(mpbBridge), _amount);
			(uint256 lzFee, ) = ILayerZeroFeeEstimator(address(mpbBridge))
				.estimateSendFee(
					mpbBridge.toLzChainId(_recipient.chainId),
					address(this),
					_recipient.addr,
					_amount,
					false,
					abi.encodePacked(uint16(1), uint256(400000)) // 400k gas to execute bridge at target chain
				);
			if (lzFee > feeSettings.maxFee || lzFee > address(this).balance)
				revert FEE_LIMIT(lzFee);

			mpbBridge.bridgeToWithLz{ value: lzFee }(
				_recipient.addr,
				_recipient.chainId,
				_amount,
				""
			);
		} else if (_recipient.transferType == TransferType.TransferAndCall) {
			nativeToken().transferAndCall(_recipient.addr, _amount, "");
		} else if (_recipient.transferType == TransferType.Transfer) {
			nativeToken().transfer(_recipient.addr, _amount);
		}
	}

	function calcGDToSell(
		uint256 maxAmountToSell
	) public view returns (uint256 gdToSell, uint256 minReceived) {
		uint24[] memory fees = new uint24[](1);
		fees[0] = 100;
		uint256 nativeToBuy = feeSettings.minBalanceForFees *
			3 -
			address(this).balance;
		(uint256 nativeValueInUSD, ) = STATIC_ORACLE
			.quoteSpecificFeeTiersWithTimePeriod(
				uint128(nativeToBuy),
				CELO,
				CUSD,
				fees,
				60 //last 1 minute
			);

		fees[0] = 10000;
		(gdToSell, ) = STATIC_ORACLE.quoteSpecificFeeTiersWithTimePeriod(
			uint128(nativeValueInUSD),
			CUSD,
			address(nativeToken()),
			fees,
			60 //last 1 minute
		);

		minReceived = nativeToBuy;
		if (gdToSell > maxAmountToSell) {
			gdToSell = maxAmountToSell;

			fees[0] = 10000;
			// gdToSell = (nativeValueInUSD * 1e18) / gdPriceInUSD; // mul by 1e18 so result is in 18 decimals
			(uint256 minReceivedCUSD, ) = STATIC_ORACLE
				.quoteSpecificFeeTiersWithTimePeriod(
					uint128(gdToSell),
					address(nativeToken()),
					CUSD,
					fees,
					60 //last 1 minute
				);

			fees[0] = 100;
			(minReceived, ) = STATIC_ORACLE.quoteSpecificFeeTiersWithTimePeriod(
				uint128(minReceivedCUSD),
				CUSD,
				CELO,
				fees,
				60 //last 1 minute
			);
			// console.log(
			// 	"minReceivedCUSD %s minReceived: %s",
			// 	minReceivedCUSD,
			// 	minReceived
			// );
		}
		// console.log("gdToSell %s minReceivedNative: %s", gdToSell, minReceived);
		// console.log(
		// 	"gdPriceInUSD: %s nativeValueInUSD:%s",
		// 	gdPriceInUSD,
		// 	nativeValueInUSD
		// );
	}

	function buyNativeWithGD(
		uint256 amountToSell,
		uint256 minReceived
	) internal returns (uint256 nativeBought) {
		ERC20(nativeToken()).approve(address(ROUTER), amountToSell);
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(
				nativeToken(),
				uint24(10000),
				CUSD,
				uint24(100),
				CELO
			),
			recipient: address(this),
			amountIn: amountToSell,
			amountOutMinimum: (minReceived * (100 - feeSettings.maxSlippage)) / 100 // 5% slippage
		});
		return ROUTER.exactInput(params);
	}
}
