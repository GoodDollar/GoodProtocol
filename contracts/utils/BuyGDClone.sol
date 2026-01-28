// SPDX-License-Identifier: MIT

pragma solidity >=0.8;
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@mean-finance/uniswap-v3-oracle/solidity/interfaces/IStaticOracle.sol";
import "../Interfaces.sol";
import "../MentoInterfaces.sol";

/*
 * @title BuyGDClone
 * @notice This contract allows users to swap Celo or stable for GoodDollar (GD) tokens.
 * @dev This contract is a clone of the BuyGD contract, which is used to buy GD tokens on the GoodDollar platform.
 * @dev This contract uses the SwapRouter contract to perform the swaps.
 */
contract BuyGDCloneV2 is Initializable {
	error REFUND_FAILED(uint256);
	error NO_BALANCE();
	error MENTO_NOT_CONFIGURED();

	event Bought(address inToken, uint256 inAmount, uint256 outAmount);
	event BoughtFromMento(address inToken, uint256 inAmount, uint256 outAmount);
	event BoughtFromUniswap(address inToken, uint256 inAmount, uint256 outAmount);

	ISwapRouter public immutable router;
	address public constant celo = 0x471EcE3750Da237f93B8E339c536989b8978a438;
	address public constant CUSD = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
	uint24 public constant GD_FEE_TIER = 500;
	uint32 public immutable twapPeriod;
	address public immutable stable;
	address public immutable gd;
	IStaticOracle public immutable oracle;

	// Mento reserve configuration (optional)
	IBroker public immutable mentoBroker;
	address public immutable mentoExchangeProvider;
	bytes32 public immutable mentoExchangeId;

	address public owner;

	receive() external payable {}

	constructor(
		ISwapRouter _router,
		address _stable,
		address _gd,
		IStaticOracle _oracle,
		IBroker _mentoBroker,
		address _mentoExchangeProvider,
		bytes32 _mentoExchangeId
	) {
		router = _router;
		stable = _stable;
		gd = _gd;
		oracle = _oracle;
		twapPeriod = 300; //5 minutes
		mentoBroker = _mentoBroker;
		mentoExchangeProvider = _mentoExchangeProvider;
		mentoExchangeId = _mentoExchangeId;
	}

	/**
	 * @notice Initializes the contract with the owner's address.
	 * @param _owner The address of the owner of the contract.
	 */
	function initialize(address _owner) external initializer {
		owner = _owner;
	}

	/**
	 * @notice Swaps either Celo or stable for GD tokens.
	 * @dev If the contract has a balance of Celo, it will swap Celo for GD tokens.
	 * @dev If the contract has a balance of stable, it will swap stable for GD tokens.
	 * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	 */
	function swap(
		uint256 _minAmount,
		address payable refundGas
	) public payable returns (uint256 bought) {
		uint256 balance = address(this).balance;

		if (balance > 0) {
			bought = swapCelo(_minAmount, refundGas);
			emit Bought(celo, balance, bought);
			return bought;
		}
		balance = ERC20(CUSD).balanceOf(address(this));
		if (balance > 0) {
			bought = swapCusd(_minAmount, refundGas);
			emit Bought(celo, balance, bought);
			return bought;
		}

		revert NO_BALANCE();
	}

	/**
	 * @notice Swaps Celo for GD tokens.
	 * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	 */
	function swapCelo(
		uint256 _minAmount,
		address payable refundGas
	) public payable returns (uint256 bought) {
		uint256 gasCosts;
		uint24[] memory fees = new uint24[](1);
		fees[0] = 500;
		if (refundGas != owner) {
			(gasCosts, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
				1e17, //0.1$
				stable,
				celo,
				fees,
				60
			);
		}

		uint256 amountIn = address(this).balance - gasCosts;

		(uint256 minByTwap, ) = minAmountByTWAP(amountIn, celo, twapPeriod);
		_minAmount = _minAmount > minByTwap ? _minAmount : minByTwap;

		ERC20(celo).approve(address(router), amountIn);
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(celo, uint24(500), stable, GD_FEE_TIER, gd),
			recipient: owner,
			amountIn: amountIn,
			amountOutMinimum: _minAmount
		});
		bought = router.exactInput(params);
		if (refundGas != owner) {
			(bool sent, ) = refundGas.call{ value: gasCosts }("");
			if (!sent) revert REFUND_FAILED(gasCosts);
		}
	}

	/**
	 * @notice Swaps cUSD for GD tokens, choosing the best route between Uniswap and Mento.
	 * @dev Compares expected returns from both Uniswap and Mento (if available) and uses the better option.
	 * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	 * @param refundGas The address to refund gas costs to (if not owner).
	 * @return bought The amount of GD tokens received.
	 */
	function swapCusd(
		uint256 _minAmount,
		address refundGas
	) public returns (uint256 bought) {
		uint256 gasCosts = refundGas != owner ? 1e17 : 0; //fixed 0.1$
		uint256 amountIn = ERC20(CUSD).balanceOf(address(this)) - gasCosts;
		require(amountIn > 0, "No cUSD balance");

		// Get expected return from Uniswap
		uint256 uniswapExpected = getExpectedReturnFromUniswap(amountIn);

		// Get expected return from Mento (if configured)
		uint256 mentoExpected = 0;
		bool mentoAvailable = address(mentoBroker) != address(0) && 
		                      mentoExchangeProvider != address(0) && 
		                      mentoExchangeId != bytes32(0);
		
		if (mentoAvailable) {
			mentoExpected = getExpectedReturnFromMento(amountIn);
		}
		uint256 maxExpected = Math.max(_minAmount, Math.max(uniswapExpected, mentoExpected));
		// Choose the better option
		if (mentoExpected > uniswapExpected) {
			// Use Mento if it provides better return
			bought = _swapCusdFromMento(maxExpected, refundGas);
		} else {
			// Use Uniswap (default or if Mento not available/not better)
			bought = _swapCUSDfromUniswap(maxExpected - 1, refundGas);
		}
	}

	/**
	 * @notice Swaps cUSD for GD tokens using Uniswap pools.
	 * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	 * @param refundGas The address to refund gas costs to (if not owner).
	 * @return bought The amount of GD tokens received.
	 */
	function _swapCUSDfromUniswap(
		uint256 _minAmount,
		address refundGas
	) internal returns (uint256 bought) {
		uint256 gasCosts = refundGas != owner ? 1e17 : 0; //fixed 0.1$
		uint256 amountIn = ERC20(CUSD).balanceOf(address(this)) - gasCosts;

		ERC20(CUSD).approve(address(router), amountIn);
		bytes memory path;
		if (stable == CUSD) {
			path = abi.encodePacked(CUSD, GD_FEE_TIER, gd);
		} else {
			path = abi.encodePacked(CUSD, uint24(100), stable, GD_FEE_TIER, gd);
		}
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: path,
			recipient: owner,
			amountIn: amountIn,
			amountOutMinimum: _minAmount
		});
		bought = router.exactInput(params);
		if (refundGas != owner) {
			ERC20(CUSD).transfer(refundGas, gasCosts);
		}
		emit BoughtFromUniswap(CUSD, amountIn, bought);
	}

	/**
	 * @notice Swaps cUSD for G$ tokens using Mento reserve.
	 * @dev Requires Mento broker, exchange provider, and exchange ID to be configured.
	 * @param _minAmount The minimum amount of G$ tokens to receive from the swap.
	 * @param refundGas The address to refund gas costs to (if not owner).
	 * @return bought The amount of G$ tokens received.
	 */
	function _swapCusdFromMento(
		uint256 _minAmount,
		address refundGas
	) internal returns (uint256 bought) {
		if (address(mentoBroker) == address(0) || mentoExchangeProvider == address(0) || mentoExchangeId == bytes32(0)) {
			revert MENTO_NOT_CONFIGURED();
		}

		uint256 gasCosts = refundGas != owner ? 1e17 : 0; //fixed 0.1$
		uint256 amountIn = ERC20(CUSD).balanceOf(address(this)) - gasCosts;
		require(amountIn > 0, "No cUSD balance");

		// Approve broker to spend cUSD
		ERC20(CUSD).approve(address(mentoBroker), amountIn);

		// Execute swap through Mento broker
		bought = mentoBroker.swapIn(
			mentoExchangeProvider,
			mentoExchangeId,
			CUSD,
			gd,
			amountIn,
			_minAmount
		);

		// Transfer G$ to owner
		ERC20(gd).transfer(owner, bought);

		// Refund gas costs if needed
		if (refundGas != owner && gasCosts > 0) {
			ERC20(CUSD).transfer(refundGas, gasCosts);
		}

		emit BoughtFromMento(CUSD, amountIn, bought);
	}

	/**
	 * @notice Gets expected return from Uniswap for a given amount of cUSD.
	 * @param cusdAmount The amount of cUSD to swap.
	 * @return expectedReturn The expected amount of G$ tokens to receive from Uniswap.
	 */
	function getExpectedReturnFromUniswap(
		uint256 cusdAmount
	) public view returns (uint256 expectedReturn) {
		(uint256 minByTwap,) = minAmountByTWAP(cusdAmount, CUSD, twapPeriod);
		return minByTwap;
	}

	/**
	 * @notice Calculates the expected return of G$ tokens for a given amount of cUSD using Mento reserve.
	 * @dev This is a view function that queries the Mento broker for the expected output.
	 * @param cusdAmount The amount of cUSD to swap.
	 * @return expectedReturn The expected amount of G$ tokens to receive.
	 */
	function getExpectedReturnFromMento(
		uint256 cusdAmount
	) public view returns (uint256 expectedReturn) {
		if (address(mentoBroker) == address(0) || mentoExchangeProvider == address(0) || mentoExchangeId == bytes32(0)) {
			revert MENTO_NOT_CONFIGURED();
		}

		expectedReturn = mentoBroker.getAmountOut(
			mentoExchangeProvider,
			mentoExchangeId,
			CUSD,
			gd,
			cusdAmount
		);
	}

	/**
	 * @notice Calculates the minimum amount of tokens that can be received for a given amount of base tokens,
	 * based on the time-weighted average price (TWAP) of the token pair over a specified period of time.
	 * @param baseAmount The amount of base tokens to swap.
	 * @param baseToken The address of the base token.
	 * @return minTwap The minimum amount of G$ expected to receive by twap
	 */
	function minAmountByTWAP(
		uint256 baseAmount,
		address baseToken,
		uint32 period
	) public view returns (uint256 minTwap, uint256 quote) {
		uint24[] memory fees = new uint24[](1);

		uint128 toConvert = uint128(baseAmount);
		if (baseToken == celo) {
			/// Set the fee to 500 since there is no pool with a 100 fee tier
			fees[0] = 500;
			(quote, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
				toConvert,
				baseToken,
				stable,
				fees,
				period
			);
			toConvert = uint128(quote);
		} else if (baseToken == CUSD && stable != CUSD) {
			fees[0] = 100;
			(quote, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
				toConvert,
				baseToken,
				stable,
				fees,
				period
			);
			toConvert = uint128(quote);
		}
		fees[0] = GD_FEE_TIER;
		(quote, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
			toConvert,
			stable,
			gd,
			fees,
			period
		);
		//minAmount should not be 2% under twap (ie we dont expect price movement > 2% in timePeriod)
		return ((quote * 98) / 100, quote);
	}

	/**
	 * @notice Recovers tokens accidentally sent to the contract.
	 * @param token The address of the token to recover. Use address(0) to recover ETH.
	 */
	function recover(address token) external virtual {
		if (token == address(0)) {
			(bool sent, ) = payable(owner).call{ value: address(this).balance }("");
			if (!sent) revert REFUND_FAILED(address(this).balance);
		} else {
			ERC20(token).transfer(owner, ERC20(token).balanceOf(address(this)));
		}
	}
}

contract DonateGDClone is BuyGDCloneV2 {
	error EXEC_FAILED(bytes error);

	event Donated(
		address donor,
		address recipient,
		address tokenDonated,
		uint256 amountDonated
	);

	address public recoverTo;
	bytes public callData;

	constructor(
		ISwapRouter _router,
		address _stable,
		address _gd,
		IStaticOracle _oracle,
		IBroker _mentoBroker,
		address _mentoExchangeProvider,
		bytes32 _mentoExchangeId
	) BuyGDCloneV2(_router, _stable, _gd, _oracle, _mentoBroker, _mentoExchangeProvider, _mentoExchangeId) {}

	/**
	 * @notice Initializes the contract with the owner's address.
	 * @param _recoverTo The address of the owner of the contract that can recover stuck funds
	 * @param _donateTo The address of the funds target
	 */
	function initialize(
		address _recoverTo,
		address _donateTo,
		bytes memory _callData
	) external initializer {
		owner = _donateTo;
		recoverTo = _recoverTo;
		callData = _callData;
	}

	function exec(
		uint256 _minAmount,
		address payable refundGas,
		bool withSwap
	) public payable {
		// in case we need to swap and call a contract, we redirect funds here
		address tempOwner = owner;
		if (withSwap && callData.length > 0) {
			owner = address(this);
		}
		//no perform swap
		address token;
		uint256 donated;
		if (withSwap) {
			token = gd;
			donated = swap(_minAmount, refundGas);
			owner = tempOwner;
		}

		//now exec
		if (callData.length > 0) {
			// approve spend of the different possible tokens, before calling the target contract
			uint256 cusdBalance = ERC20(CUSD).balanceOf(address(this));
			uint256 gdBalance = ERC20(gd).balanceOf(address(this));
			uint256 celoBalance = address(this).balance;

			if (cusdBalance > 0) {
				ERC20(CUSD).approve(address(owner), cusdBalance);
				token = CUSD;
				donated = cusdBalance;
			}
			if (gdBalance > 0) {
				ERC20(gd).approve(address(owner), gdBalance);
				token = gd;
				donated = gdBalance;
			}
			if (celoBalance > 0) {
				ERC20(celo).approve(address(owner), celoBalance);
				token = celo;
				donated = celoBalance;
			}

			(bool success, bytes memory data) = owner.call{ value: 0 }(callData);
			if (!success) revert EXEC_FAILED(data);
		}
		emit Donated(recoverTo, owner, token, donated);
	}

	/**
	 * @notice Recovers tokens accidentally sent to the contract.
	 * @param token The address of the token to recover. Use address(0) to recover ETH.
	 */
	function recover(address token) external virtual override {
		if (token == address(0)) {
			(bool sent, ) = payable(recoverTo).call{ value: address(this).balance }(
				""
			);
			if (!sent) revert REFUND_FAILED(address(this).balance);
		} else {
			ERC20(token).transfer(recoverTo, ERC20(token).balanceOf(address(this)));
		}
	}
}

/**
 * @title BuyGDCloneFactory
 * @notice Factory contract for creating clones of BuyGDClone contract
 */
contract BuyGDCloneFactory {
	error NOT_GD_TOKEN();
	error INVALID_TWAP();
	error RECIPIENT_ZERO();
	error ZERO_MINAMOUNT();

	IQuoterV2 public constant quoter =
		IQuoterV2(0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8); // celo quoter
	address public constant CUSD = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
	address public constant celo = 0x471EcE3750Da237f93B8E339c536989b8978a438;
	uint24 public constant PERIOD = 600;

	address public immutable impl;
	address public immutable donateImpl;
	address public immutable gd;
	address public immutable stable;
	IStaticOracle public immutable oracle;
	ISwapRouter public immutable router;

	event GDSwapToCusd(
		address from,
		address to,
		uint256 amountIn,
		uint256 amountOut,
		bytes note
	);

	// Mento configuration (optional)
	IBroker public immutable mentoBroker;
	address public immutable mentoExchangeProvider;
	bytes32 public immutable mentoExchangeId;

	/**
	 * @notice Initializes the BuyGDCloneFactory contract with the provided parameters.
	 * @param _router The address of the SwapRouter contract.
	 * @param _stable The address of the stable token contract.
	 * @param _gd The address of the GD token contract.
	 * @param _oracle The address of the StaticOracle contract.
	 * @param _mentoBroker The address of the Mento broker contract (optional, can be address(0)).
	 * @param _mentoExchangeProvider The address of the Mento exchange provider (optional, can be address(0)).
	 * @param _mentoExchangeId The exchange ID for the Mento G$/cUSD exchange (optional, can be bytes32(0)).
	 */
	constructor(
		ISwapRouter _router,
		address _stable,
		address _gd,
		IStaticOracle _oracle,
		IBroker _mentoBroker,
		address _mentoExchangeProvider,
		bytes32 _mentoExchangeId
	) {
		impl = address(new BuyGDCloneV2(_router, _stable, _gd, _oracle, _mentoBroker, _mentoExchangeProvider, _mentoExchangeId));
		donateImpl = address(new DonateGDClone(_router, _stable, _gd, _oracle, _mentoBroker, _mentoExchangeProvider, _mentoExchangeId));
		gd = _gd;
		stable = _stable;
		oracle = _oracle;
		router = _router;
		
		mentoBroker = _mentoBroker;
		mentoExchangeProvider = _mentoExchangeProvider;
		mentoExchangeId = _mentoExchangeId;

		_oracle.prepareAllAvailablePoolsWithTimePeriod(_gd, _stable, PERIOD); //stable/gd pools
		_oracle.prepareAllAvailablePoolsWithTimePeriod(
			celo,
			_stable,
			PERIOD
		); //celo/stable pools
		_oracle.prepareAllAvailablePoolsWithTimePeriod(CUSD, _stable, PERIOD); //cusd/stable pools
	}

	/**
	 * @notice Creates a new clone of the BuyGDClone contract with the provided owner address.
	 * @param owner The address of the owner of the new BuyGDClone contract.
	 * @return The address of the new BuyGDClone contract.
	 */
	function create(address owner) public returns (address) {
		bytes32 salt = keccak256(abi.encode(owner));
		address clone = ClonesUpgradeable.cloneDeterministic(impl, salt);
		BuyGDCloneV2(payable(clone)).initialize(owner);
		return clone;
	}

	/**
	 * @notice Creates a new clone of the BuyGDClone contract with the provided owner address.
	 * @param owner The address of the owner of the new DoanteGDClone contract that can recover funds.
	 * @param donateOrExecTo The address of the target for funds
	 * @param callData a payload to execute on the target donateOrExecTo instead of simple transfers (using approve instead)
	 *
	 * @return The address of the new BuyGDClone contract.
	 */
	function createDonation(
		address owner,
		address donateOrExecTo,
		bytes memory callData
	) public returns (address) {
		bytes32 salt = keccak256(abi.encode(owner, donateOrExecTo, callData));
		address clone = ClonesUpgradeable.cloneDeterministic(donateImpl, salt);
		DonateGDClone(payable(clone)).initialize(owner, donateOrExecTo, callData);
		return clone;
	}

	function createAndSwap(
		address owner,
		uint256 minAmount
	) external returns (address) {
		address clone = create(owner);
		BuyGDCloneV2(payable(clone)).swap(minAmount, payable(msg.sender));
		return clone;
	}

	function createDonationAndSwap(
		address owner,
		address donateOrExecTo,
		bool withSwap,
		uint256 minAmount,
		bytes memory callData
	) external returns (address) {
		address clone = createDonation(owner, donateOrExecTo, callData);
		DonateGDClone(payable(clone)).exec(
			minAmount,
			payable(msg.sender),
			withSwap
		);
		return clone;
	}

	/**
	 * @notice Predicts the address of a new clone of the BuyGDClone contract with the provided owner address.
	 * @param owner The address of the owner of the new BuyGDClone contract.
	 * @return The predicted address of the new BuyGDClone contract.
	 */
	function predict(address owner) external view returns (address) {
		bytes32 salt = keccak256(abi.encode(owner));

		return
			ClonesUpgradeable.predictDeterministicAddress(impl, salt, address(this));
	}

	/**
	 * @notice Predicts the address of a new clone of the BuyGDClone contract with the provided owner address.
	 * @param owner The address of the owner of the new BuyGDClone contract.
	 * @return The predicted address of the new BuyGDClone contract.
	 */
	function predictDonation(
		address owner,
		address donateOrExecTo,
		bytes memory callData
	) external view returns (address) {
		bytes32 salt = keccak256(abi.encode(owner, donateOrExecTo, callData));

		return
			ClonesUpgradeable.predictDeterministicAddress(
				donateImpl,
				salt,
				address(this)
			);
	}

	function getBaseFee() external view returns (uint256) {
		return block.basefee;
	}

	// function onTokenTransfer(
	// 	address from,
	// 	uint256 amount,
	// 	bytes calldata data
	// ) external returns (bool) {
	// 	if (msg.sender != gd) revert NOT_GD_TOKEN();
	// 	(address to, uint256 minAmount, bytes memory note) = abi.decode(
	// 		data,
	// 		(address, uint256, bytes)
	// 	);
	// 	if (to == address(0)) revert RECIPIENT_ZERO();

	// 	uint256 amountIn = ERC20(gd).balanceOf(address(this));

	// 	uint256 amountReceived = swapToCusd(amountIn, minAmount, to);
	// 	emit GDSwapToCusd(from, to, amount, amountReceived, note);
	// 	return true;
	// }

	// /**
	//  * @notice Swaps cUSD for GD tokens.
	//  * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	//  */
	// function swapToCusd(
	// 	uint256 amountIn,
	// 	uint256 _minAmount,
	// 	address recipient
	// ) public returns (uint256) {
	// 	if (msg.sender != gd) {
	// 		ERC20(gd).transferFrom(msg.sender, address(this), amountIn);
	// 	}

	// 	if (_minAmount == 0)
	// 		(_minAmount, ) = minAmountByTWAP(amountIn, gd, cusd, 60);

	// 	ERC20(gd).approve(address(router), amountIn);
	// 	ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
	// 		path: abi.encodePacked(gd, uint24(10000), cusd),
	// 		recipient: recipient,
	// 		amountIn: amountIn,
	// 		amountOutMinimum: _minAmount
	// 	});
	// 	return router.exactInput(params);
	// }

	// /**
	//  * @notice Swaps cUSD for GD tokens.
	//  * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	//  */
	// function swapFromCusd(
	// 	uint256 amountIn,
	// 	uint256 _minAmount,
	// 	address recipient
	// ) public returns (uint256) {
	// 	ERC20(cusd).transferFrom(msg.sender, address(this), amountIn);

	// 	if (_minAmount == 0)
	// 		(_minAmount, ) = minAmountByTWAP(amountIn, cusd, gd, 60);

	// 	ERC20(cusd).approve(address(router), amountIn);
	// 	ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
	// 		path: abi.encodePacked(cusd, uint24(10000), gd),
	// 		recipient: recipient,
	// 		amountIn: amountIn,
	// 		amountOutMinimum: _minAmount
	// 	});
	// 	return router.exactInput(params);
	// }

	// /**
	//  * @notice Calculates the minimum amount of tokens that can be received for a given amount of base tokens,
	//  * based on the time-weighted average price (TWAP) of the token pair over a specified period of time.
	//  * @param baseAmount The amount of base tokens to swap.
	//  * @param baseToken The address of the base token.
	//  * @param qtToken The address of the quote token.

	//  * @return minTwap The minimum amount of G$ expected to receive by twap
	//  */
	// function minAmountByTWAP(
	// 	uint256 baseAmount,
	// 	address baseToken,
	// 	address qtToken,
	// 	uint32 period
	// ) public view returns (uint256 minTwap, uint256 quote) {
	// 	uint24[] memory fees = new uint24[](1);
	// 	fees[0] = 10000;
	// 	uint128 toConvert = uint128(baseAmount);
	// 	(quote, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
	// 		toConvert,
	// 		baseToken,
	// 		qtToken,
	// 		fees,
	// 		period
	// 	);

	// 	(uint256 curPrice, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
	// 		toConvert,
	// 		baseToken,
	// 		qtToken,
	// 		fees,
	// 		0
	// 	);

	// 	// (ie we dont expect price movement > 2% in timePeriod)
	// 	if ((quote * 98) / 100 > curPrice) {
	// 		revert INVALID_TWAP();
	// 	}
	// 	//minAmount should not be 2% under curPrice (including slippage and price impact)
	// 	//this is just a guesstimate, for accurate results use uniswap sdk to get price quote
	// 	//v3 price quote is not available on chain
	// 	return ((curPrice * 980) / 1000, quote);
	// }

	// function quoteCusd(uint256 amountIn) external returns (uint256 amountOut) {
	// 	return quoteToken(amountIn, 10000, cusd);
	// }

	// function quoteToken(
	// 	uint256 amountIn,
	// 	uint24 fee,
	// 	address targetToken
	// ) public returns (uint256 amountOut) {
	// 	IQuoterV2.QuoteExactInputSingleParams memory params;
	// 	params.amountIn = amountIn;
	// 	params.tokenIn = gd;
	// 	params.tokenOut = targetToken;
	// 	params.fee = fee;

	// 	(amountOut, , , ) = quoter.quoteExactInputSingle(params);
	// }
}
