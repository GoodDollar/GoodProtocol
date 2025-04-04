// SPDX-License-Identifier: MIT

pragma solidity >=0.8;
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@mean-finance/uniswap-v3-oracle/solidity/interfaces/IStaticOracle.sol";
import "../Interfaces.sol";

/*
 * @title BuyGDClone
 * @notice This contract allows users to swap Celo or cUSD for GoodDollar (GD) tokens.
 * @dev This contract is a clone of the BuyGD contract, which is used to buy GD tokens on the GoodDollar platform.
 * @dev This contract uses the SwapRouter contract to perform the swaps.
 */
contract BuyGDClone is Initializable {
	error REFUND_FAILED(uint256);
	error NO_BALANCE();

	event Bought(address inToken, uint256 inAmount, uint256 outAmount);

	ISwapRouter public immutable router;
	address public constant celo = 0x471EcE3750Da237f93B8E339c536989b8978a438;
	uint32 public immutable twapPeriod;
	address public immutable cusd;
	address public immutable gd;
	IStaticOracle public immutable oracle;

	address public owner;

	receive() external payable {}

	constructor(
		ISwapRouter _router,
		address _cusd,
		address _gd,
		IStaticOracle _oracle
	) {
		router = _router;
		cusd = _cusd;
		gd = _gd;
		oracle = _oracle;
		twapPeriod = 300; //5 minutes
	}

	/**
	 * @notice Initializes the contract with the owner's address.
	 * @param _owner The address of the owner of the contract.
	 */
	function initialize(address _owner) external initializer {
		owner = _owner;
	}

	/**
	 * @notice Swaps either Celo or cUSD for GD tokens.
	 * @dev If the contract has a balance of Celo, it will swap Celo for GD tokens.
	 * @dev If the contract has a balance of cUSD, it will swap cUSD for GD tokens.
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
		balance = ERC20(cusd).balanceOf(address(this));
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
		if (refundGas != owner) {
			(gasCosts, ) = oracle.quoteAllAvailablePoolsWithTimePeriod(
				1e17, //0.1$
				cusd,
				celo,
				60
			);
		}

		uint256 amountIn = address(this).balance - gasCosts;

		(uint256 minByTwap, ) = minAmountByTWAP(amountIn, celo, twapPeriod);
		_minAmount = _minAmount > minByTwap ? _minAmount : minByTwap;

		ERC20(celo).approve(address(router), amountIn);
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(celo, uint24(3000), cusd, uint24(10000), gd),
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
	 * @notice Swaps cUSD for GD tokens.
	 * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	 */
	function swapCusd(
		uint256 _minAmount,
		address refundGas
	) public returns (uint256 bought) {
		uint256 gasCosts = refundGas != owner ? 1e17 : 0; //fixed 0.1$
		uint256 amountIn = ERC20(cusd).balanceOf(address(this)) - gasCosts;

		(uint256 minByTwap, ) = minAmountByTWAP(amountIn, cusd, twapPeriod);
		_minAmount = _minAmount > minByTwap ? _minAmount : minByTwap;

		ERC20(cusd).approve(address(router), amountIn);
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(cusd, uint24(10000), gd),
			recipient: owner,
			amountIn: amountIn,
			amountOutMinimum: _minAmount
		});
		bought = router.exactInput(params);
		if (refundGas != owner) {
			ERC20(cusd).transfer(refundGas, gasCosts);
		}
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
		fees[0] = 10000;

		uint128 toConvert = uint128(baseAmount);
		if (baseToken == celo) {
			(quote, ) = oracle.quoteAllAvailablePoolsWithTimePeriod(
				toConvert,
				baseToken,
				cusd,
				period
			);
			toConvert = uint128(quote);
		}
		(quote, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
			toConvert,
			cusd,
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

contract DonateGDClone is BuyGDClone {
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
		address _cusd,
		address _gd,
		IStaticOracle _oracle
	) BuyGDClone(_router, _cusd, _gd, _oracle) {}

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
			uint256 cusdBalance = ERC20(cusd).balanceOf(address(this));
			uint256 gdBalance = ERC20(gd).balanceOf(address(this));
			uint256 celoBalance = address(this).balance;

			if (cusdBalance > 0) {
				ERC20(cusd).approve(address(owner), cusdBalance);
				token = cusd;
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

	address public immutable impl;
	address public immutable donateImpl;
	address public immutable gd;
	address public immutable cusd;
	IStaticOracle public immutable oracle;
	ISwapRouter public immutable router;

	event GDSwapToCusd(
		address from,
		address to,
		uint256 amountIn,
		uint256 amountOut,
		bytes note
	);

	/**
	 * @notice Initializes the BuyGDCloneFactory contract with the provided parameters.
	 * @param _router The address of the SwapRouter contract.
	 * @param _cusd The address of the cUSD token contract.
	 * @param _gd The address of the GD token contract.
	 * @param _oracle The address of the StaticOracle contract.
	 */
	constructor(
		ISwapRouter _router,
		address _cusd,
		address _gd,
		IStaticOracle _oracle
	) {
		impl = address(new BuyGDClone(_router, _cusd, _gd, _oracle));
		donateImpl = address(new DonateGDClone(_router, _cusd, _gd, _oracle));
		gd = _gd;
		cusd = _cusd;
		oracle = _oracle;
		router = _router;
		_oracle.prepareAllAvailablePoolsWithTimePeriod(_gd, _cusd, 600);
	}

	/**
	 * @notice Creates a new clone of the BuyGDClone contract with the provided owner address.
	 * @param owner The address of the owner of the new BuyGDClone contract.
	 * @return The address of the new BuyGDClone contract.
	 */
	function create(address owner) public returns (address) {
		bytes32 salt = keccak256(abi.encode(owner));
		address clone = ClonesUpgradeable.cloneDeterministic(impl, salt);
		BuyGDClone(payable(clone)).initialize(owner);
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
		BuyGDClone(payable(clone)).swap(minAmount, payable(msg.sender));
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

	function onTokenTransfer(
		address from,
		uint256 amount,
		bytes calldata data
	) external returns (bool) {
		if (msg.sender != gd) revert NOT_GD_TOKEN();
		(address to, uint256 minAmount, bytes memory note) = abi.decode(
			data,
			(address, uint256, bytes)
		);
		if (to == address(0)) revert RECIPIENT_ZERO();

		uint256 amountIn = ERC20(gd).balanceOf(address(this));

		uint256 amountReceived = swapToCusd(amountIn, minAmount, to);
		emit GDSwapToCusd(from, to, amount, amountReceived, note);
		return true;
	}

	/**
	 * @notice Swaps cUSD for GD tokens.
	 * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	 */
	function swapToCusd(
		uint256 amountIn,
		uint256 _minAmount,
		address recipient
	) public returns (uint256) {
		if (msg.sender != gd) {
			ERC20(gd).transferFrom(msg.sender, address(this), amountIn);
		}

		if (_minAmount == 0)
			(_minAmount, ) = minAmountByTWAP(amountIn, gd, cusd, 60);

		ERC20(gd).approve(address(router), amountIn);
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(gd, uint24(10000), cusd),
			recipient: recipient,
			amountIn: amountIn,
			amountOutMinimum: _minAmount
		});
		return router.exactInput(params);
	}

	/**
	 * @notice Swaps cUSD for GD tokens.
	 * @param _minAmount The minimum amount of GD tokens to receive from the swap.
	 */
	function swapFromCusd(
		uint256 amountIn,
		uint256 _minAmount,
		address recipient
	) public returns (uint256) {
		ERC20(cusd).transferFrom(msg.sender, address(this), amountIn);

		if (_minAmount == 0)
			(_minAmount, ) = minAmountByTWAP(amountIn, cusd, gd, 60);

		ERC20(cusd).approve(address(router), amountIn);
		ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
			path: abi.encodePacked(cusd, uint24(10000), gd),
			recipient: recipient,
			amountIn: amountIn,
			amountOutMinimum: _minAmount
		});
		return router.exactInput(params);
	}

	/**
	 * @notice Calculates the minimum amount of tokens that can be received for a given amount of base tokens,
	 * based on the time-weighted average price (TWAP) of the token pair over a specified period of time.
	 * @param baseAmount The amount of base tokens to swap.
	 * @param baseToken The address of the base token.
	 * @param qtToken The address of the quote token.

	 * @return minTwap The minimum amount of G$ expected to receive by twap
	 */
	function minAmountByTWAP(
		uint256 baseAmount,
		address baseToken,
		address qtToken,
		uint32 period
	) public view returns (uint256 minTwap, uint256 quote) {
		uint24[] memory fees = new uint24[](1);
		fees[0] = 10000;
		uint128 toConvert = uint128(baseAmount);
		(quote, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
			toConvert,
			baseToken,
			qtToken,
			fees,
			period
		);

		(uint256 curPrice, ) = oracle.quoteSpecificFeeTiersWithTimePeriod(
			toConvert,
			baseToken,
			qtToken,
			fees,
			0
		);

		// (ie we dont expect price movement > 2% in timePeriod)
		if ((quote * 98) / 100 > curPrice) {
			revert INVALID_TWAP();
		}
		//minAmount should not be 2% under curPrice (including slippage and price impact)
		//this is just a guesstimate, for accurate results use uniswap sdk to get price quote
		//v3 price quote is not available on chain
		return ((curPrice * 980) / 1000, quote);
	}

	function quoteCusd(uint256 amountIn) external returns (uint256 amountOut) {
		return quoteToken(amountIn, 10000, cusd);
	}

	function quoteToken(
		uint256 amountIn,
		uint24 fee,
		address targetToken
	) public returns (uint256 amountOut) {
		IQuoterV2.QuoteExactInputSingleParams memory params;
		params.amountIn = amountIn;
		params.tokenIn = gd;
		params.tokenOut = targetToken;
		params.fee = fee;

		(amountOut, , , ) = quoter.quoteExactInputSingle(params);
	}
}
