// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@mean-finance/uniswap-v3-oracle/solidity/interfaces/IStaticOracle.sol";
import "@gooddollar/bridge-contracts/contracts/messagePassingBridge/IMessagePassingBridge.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";

import "../utils/DAOUpgradeableContract.sol";
import "../IUniswapV3.sol";

// import "hardhat/console.sol";

/***
 * @dev DistributionHelper receives funds and distributes them to recipients
 * recipients can be on other blockchains and get their funds via fuse/multichain bridge
 * accounts with ADMIN_ROLE can update the recipients, defaults to Avatar
 */
contract GenericDistributionHelper is
	DAOUpgradeableContract,
	AccessControlEnumerableUpgradeable
{
	error FEE_LIMIT(uint256 fee);
	error INVALID_CHAINID();

	bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

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

	IMessagePassingBridge private _unused_mpbBridge;
	FeeSettings public feeSettings;
	IStaticOracle public STATIC_ORACLE;
	ISwapRouter public ROUTER;

	address public gasToken;

	address public reserveToken;

	uint256 private _status; //for reentrancy guard

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
	event BuyNativeFailed(
		string reason,
		uint256 amountToSell,
		uint256 amountOutMinimum
	);

	receive() external payable {}

	modifier nonReentrant() {
		// On the first call to nonReentrant, _status will be _NOT_ENTERED
		require(_status != 1, "ReentrancyGuard: reentrant call");

		// Any calls to nonReentrant after this point will fail
		_status = 1;
		_;
		// By storing the original value once again, a refund is triggered (see
		// https://eips.ethereum.org/EIPS/eip-2200)
		_status = 0;
	}

	function initialize(
		INameService _ns,
		IStaticOracle _oracle,
		address _gasToken, //weth
		address _reserveToken,
		ISwapRouter _router,
		FeeSettings memory _feeData
	) external initializer {
		__AccessControlEnumerable_init();
		setDAO(_ns);
		_setupRole(DEFAULT_ADMIN_ROLE, avatar); //this needs to happen after setDAO for avatar to be non empty
		_setupRole(GUARDIAN_ROLE, avatar);
		STATIC_ORACLE = _oracle;
		ROUTER = _router;
		feeSettings = _feeData;
		gasToken = _gasToken;
		_setReserveToken(_reserveToken);
	}

	function getBridge() public view virtual returns (IMessagePassingBridge) {
		return IMessagePassingBridge(nameService.getAddress("MPBBRIDGE_CONTRACT"));
	}

	function setReserveToken(
		address _reserveToken
	) public onlyRole(GUARDIAN_ROLE) {
		_setReserveToken(_reserveToken);
	}

	function _setReserveToken(address _reserveToken) internal {
		reserveToken = _reserveToken;
		STATIC_ORACLE.prepareAllAvailablePoolsWithTimePeriod(
			reserveToken,
			address(nativeToken()),
			60
		);
		STATIC_ORACLE.prepareAllAvailablePoolsWithTimePeriod(
			reserveToken,
			gasToken,
			60
		);
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
	function onDistribution(uint256 _amount) external virtual nonReentrant {
		//we consider the actual balance and not _amount
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

			//try to unwrap to native
			try IWETH(gasToken).withdraw(boughtNative) {
				// success
			} catch Error(string memory reason) {
				emit BuyNativeFailed(reason, boughtNative, 0);
			} catch {
				emit BuyNativeFailed("WETH withdraw failed", boughtNative, 0);
			}
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
		if (_recipient.transferType == TransferType.LayerZeroBridge) {
			nativeToken().approve(address(getBridge()), _amount);
			(uint256 lzFee, ) = ILayerZeroFeeEstimator(address(getBridge()))
				.estimateSendFee(
					getBridge().toLzChainId(_recipient.chainId),
					address(this),
					_recipient.addr,
					_amount,
					false,
					abi.encodePacked(uint16(1), uint256(400000)) // 400k gas to execute bridge at target chain
				);
			if (lzFee > feeSettings.maxFee || lzFee > address(this).balance)
				revert FEE_LIMIT(lzFee);

			getBridge().bridgeToWithLz{ value: lzFee }(
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
		uint256 nativeToBuy = feeSettings.minBalanceForFees *
			3 -
			address(this).balance;
		(uint256 nativeValueInUSD, ) = STATIC_ORACLE
			.quoteAllAvailablePoolsWithTimePeriod(
				uint128(nativeToBuy),
				gasToken,
				reserveToken,
				60 //last 1 minute
			);

		(gdToSell, ) = STATIC_ORACLE.quoteAllAvailablePoolsWithTimePeriod(
			uint128(nativeValueInUSD),
			reserveToken,
			address(nativeToken()),
			60 //last 1 minute
		);

		minReceived = nativeToBuy;
		if (gdToSell > maxAmountToSell) {
			gdToSell = maxAmountToSell;

			// gdToSell = (nativeValueInUSD * 1e18) / gdPriceInUSD; // mul by 1e18 so result is in 18 decimals
			(uint256 minReceivedCUSD, ) = STATIC_ORACLE
				.quoteAllAvailablePoolsWithTimePeriod(
					uint128(gdToSell),
					address(nativeToken()),
					reserveToken,
					60 //last 1 minute
				);

			(minReceived, ) = STATIC_ORACLE.quoteAllAvailablePoolsWithTimePeriod(
				uint128(minReceivedCUSD),
				reserveToken,
				gasToken,
				60 //last 1 minute
			);
		}
	}

	function buyNativeWithGD(
		uint256 amountToSell,
		uint256 minReceived
	) internal returns (uint256 nativeBought) {
		address[] memory gdPools = STATIC_ORACLE.getAllPoolsForPair(
			reserveToken,
			address(nativeToken())
		);
		address[] memory gasPools = STATIC_ORACLE.getAllPoolsForPair(
			reserveToken,
			gasToken
		);
		uint24 gasFee = IUniswapV3Pool(gasPools[0]).fee();
		uint24 gdFee = IUniswapV3Pool(gdPools[0]).fee();
		for (uint i = 1; i < gasPools.length; i++) {
			uint24 fee = IUniswapV3Pool(gasPools[i]).fee();
			gasFee = gasFee < fee ? gasFee : fee;
		}
		for (uint i = 1; i < gdPools.length; i++) {
			uint24 fee = IUniswapV3Pool(gdPools[i]).fee();
			gdFee = gdFee < fee ? gdFee : fee;
		}
		ERC20(nativeToken()).approve(address(ROUTER), amountToSell);
		uint256 amountOutMinimum = (minReceived * (100 - feeSettings.maxSlippage)) /
			100; // 5% slippage
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(
				nativeToken(),
				gdFee,
				reserveToken,
				gasFee,
				gasToken
			),
			recipient: address(this),
			amountIn: amountToSell,
			amountOutMinimum: amountOutMinimum
		});
		try ROUTER.exactInput(params) returns (uint256 amountOut) {
			return amountOut;
		} catch Error(string memory reason) {
			emit BuyNativeFailed(reason, amountToSell, amountOutMinimum);
			return 0;
		}
	}
}
