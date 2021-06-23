// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../utils/DAOUpgradeableContract.sol";
import "../utils/NameService.sol";
import "./GoodReserveCDai.sol";

contract ExchangeHelper is DAOUpgradeableContract {
	uint256 private _status;

	function initialize(INameService _ns) public virtual initializer {
		setDAO(_ns);
		_status = 1;
	}

	// Emits when GD tokens are purchased
	event TokenPurchased(
		// The initiate of the action
		address indexed caller,
		// The convertible token address
		// which the GD tokens were
		// purchased with
		address indexed inputToken,
		// Reserve tokens amount
		uint256 inputAmount,
		// Actual return after the
		// conversion
		uint256 actualReturn,
		// Address of the receiver of tokens
		address indexed receiverAddress
	);
	// Emits when GD tokens are sold
	event TokenSold(
		// The initiate of the action
		address indexed caller,
		// The convertible token address
		// which the GD tokens were
		// sold to
		address indexed outputToken,
		// GD tokens amount
		uint256 gdAmount,
		// The amount of GD tokens that
		// was contributed during the
		// conversion
		uint256 contributionAmount,
		// Actual return after the
		// conversion
		uint256 actualReturn,
		// Address of the receiver of tokens
		address indexed receiverAddress
	);
	address public daiAddress;
	address public cDaiAddress;
	/**
	 * @dev Prevents a contract from calling itself, directly or indirectly.
	 * Calling a `nonReentrant` function from another `nonReentrant`
	 * function is not supported. It is possible to prevent this from happening
	 * by making the `nonReentrant` function external, and make it call a
	 * `private` function that does the actual work.
	 */
	modifier nonReentrant() {
		// On the first call to nonReentrant, _notEntered will be true
		require(_status != 2, "ReentrancyGuard: reentrant call");

		// Any calls to nonReentrant after this point will fail
		_status = 2;

		_;

		// By storing the original value once again, a refund is triggered (see
		// https://eips.ethereum.org/EIPS/eip-2200)
		_status = 1;
	}

	function setAddresses() public {
		daiAddress = nameService.getAddress("DAI");
		cDaiAddress = nameService.getAddress("CDAI");
		// Approve transfer to cDAI contract
		ERC20(daiAddress).approve(cDaiAddress, type(uint256).max);
		ERC20(daiAddress).approve(
			nameService.getAddress("UNISWAP_ROUTER"),
			type(uint256).max
		);
	}

	/**
	@dev Converts any 'buyWith' tokens to cDAI then call buy function to convert it to GD tokens(no need reentrancy lock since we don't transfer external token's to user)
	* @param _buyWith The tokens that should be converted to GD tokens
	* @param _tokenAmount The amount of `buyWith` tokens that should be converted to GD tokens
	* @param _minReturn The minimum allowed return in GD tokens
	* @param _minDAIAmount The mininmum dai out amount from Exchange swap function
	* @param _targetAddress address of g$ and gdx recipient if different than msg.sender
	* @return (gdReturn) How much GD tokens were transferred
	 */
	function buy(
		ERC20 _buyWith,
		uint256 _tokenAmount,
		uint256 _minReturn,
		uint256 _minDAIAmount,
		address _targetAddress
	) public payable returns (uint256) {
		bool withETH = false;
		GoodReserveCDai reserve = GoodReserveCDai(
			nameService.getAddress("RESERVE")
		);
		address receiver = _targetAddress == address(0x0)
			? msg.sender
			: _targetAddress;
		Uniswap uniswapContract = Uniswap(
			nameService.getAddress("UNISWAP_ROUTER")
		);
		if (address(_buyWith) == address(0)) {
			require(
				msg.value > 0 && _tokenAmount == msg.value,
				"you need to pay with ETH"
			);
			_tokenAmount = msg.value;
			_buyWith = ERC20(uniswapContract.WETH());
			withETH = true;
		} else {
			require(
				_buyWith.transferFrom(
					msg.sender,
					address(_buyWith) == cDaiAddress
						? address(reserve)
						: address(this),
					_tokenAmount
				) == true,
				"transferFrom failed, make sure you approved input token transfer"
			);
		}

		uint256 result;
		if (address(_buyWith) == cDaiAddress) {
			result = reserve.buy(_tokenAmount, _minReturn, receiver);
		} else if (address(_buyWith) == daiAddress) {
			result = _cdaiMintAndBuy(_tokenAmount, _minReturn, receiver);
		} else {
			uint256[] memory swap;
			if (withETH) {
				address[] memory path = new address[](2);
				path[0] = uniswapContract.WETH();
				path[1] = daiAddress;
				swap = uniswapContract.swapExactETHForTokens{
					value: msg.value
				}(_minDAIAmount, path, address(this), block.timestamp);
			} else {
				_buyWith.approve(address(uniswapContract), _tokenAmount);
				swap = _uniswapSwap(
					uniswapContract,
					_buyWith,
					_tokenAmount,
					true,
					0,
					_minDAIAmount,
					address(this)
				);
			}
			uint256 dai = swap[1];
			require(dai > 0, "token selling failed");

			result = _cdaiMintAndBuy(dai, _minReturn, receiver);
		}

		emit TokenPurchased(
			msg.sender,
			address(_buyWith),
			_tokenAmount,
			result,
			receiver
		);

		return result;
	}

	/**
	 * @dev Converts GD tokens to `sellTo` tokens and update the bonding curve params.
	 * `sell` occurs only if the token return is above the given minimum. Notice that
	 * there is a contribution amount from the given GD that remains in the reserve relative to user amount of GDX credits.
	 * MUST call G$ `approve` prior to this action to allow this
	 * contract to accomplish the conversion.
	 * @param _sellTo The tokens that will be received after the conversion if address equals 0x0 then sell to ETH
	 * @param _gdAmount The amount of GD tokens that should be converted to `_sellTo` tokens
	 * @param _minReturn The minimum allowed `sellTo` tokens return
	 * @param _minTokenReturn The mininmum dai out amount from Exchange swap function
	 * @param _targetAddress address of _sellTo token recipient if different than msg.sender
	 * @return (tokenReturn) How much `sellTo` tokens were transferred
	 */
	function sell(
		ERC20 _sellTo,
		uint256 _gdAmount,
		uint256 _minReturn,
		uint256 _minTokenReturn,
		address _targetAddress
	) public nonReentrant returns (uint256) {
		address receiver = _targetAddress == address(0x0)
			? msg.sender
			: _targetAddress;

		uint256 result;
		uint256 contributionAmount;
		GoodReserveCDai reserve = GoodReserveCDai(
			nameService.getAddress("RESERVE")
		);
		IGoodDollar(nameService.getAddress("GOODDOLLAR")).burnFrom(
			msg.sender,
			_gdAmount
		);
		Uniswap uniswapContract = Uniswap(
			nameService.getAddress("UNISWAP_ROUTER")
		);
		(result, contributionAmount) = reserve.sell(
			_gdAmount,
			_minReturn,
			address(_sellTo) == cDaiAddress ? receiver : address(this), // if the tokens that will received is cDai then return it directly to receiver
			msg.sender
		);
		if (address(_sellTo) == daiAddress) {
			result = _redeemDAI(result);

			require(
				_sellTo.transfer(receiver, result) == true,
				"Transfer failed"
			);
		} else if (
			address(_sellTo) != daiAddress && address(_sellTo) != cDaiAddress
		) {
			result = _redeemDAI(result);

			uint256[] memory swap;

			swap = _uniswapSwap(
				uniswapContract,
				_sellTo,
				result,
				false,
				0,
				_minTokenReturn,
				receiver
			);

			result = swap[1];
			require(result > 0, "token selling failed");
		}

		emit TokenSold(
			receiver,
			address(_sellTo),
			_gdAmount,
			contributionAmount,
			result,
			receiver
		);
		return result;
	}

	/**
	 * @dev Redeem cDAI to DAI
	 * @param _amount Amount of cDAI to redeem for DAI
	 * @return the amount of DAI received
	 */
	function _redeemDAI(uint256 _amount) internal returns (uint256) {
		cERC20 cDai = cERC20(cDaiAddress);
		ERC20 dai = ERC20(daiAddress);

		uint256 currDaiBalance = dai.balanceOf(address(this));

		uint256 daiResult = cDai.redeem(_amount);
		require(daiResult == 0, "cDai redeem failed");

		uint256 daiReturnAmount = dai.balanceOf(address(this)) - currDaiBalance;

		return daiReturnAmount;
	}

	/**
	 * @dev Convert Dai to CDAI and buy
	 * @param _amount DAI amount to convert
	 * @param _minReturn The minimum allowed return in GD tokens
	 * @param _targetAddress address of g$ and gdx recipient if different than msg.sender
	 * @return (gdReturn) How much GD tokens were transferred
	 */
	function _cdaiMintAndBuy(
		uint256 _amount,
		uint256 _minReturn,
		address _targetAddress
	) internal returns (uint256) {
		GoodReserveCDai reserve = GoodReserveCDai(
			nameService.getAddress("RESERVE")
		);
		cERC20 cDai = cERC20(cDaiAddress);

		uint256 currCDaiBalance = cDai.balanceOf(address(this));

		//Mint cDAIs
		uint256 cDaiResult = cDai.mint(_amount);
		require(cDaiResult == 0, "Minting cDai failed");

		uint256 cDaiInput = cDai.balanceOf(address(this)) - currCDaiBalance;
		cDai.transfer(address(reserve), cDaiInput);
		return reserve.buy(cDaiInput, _minReturn, _targetAddress);
	}

	/**
	@dev Helper to swap tokens in the Uniswap
	*@param _uniswapContract Uniswap Router Contract
	*@param _token token to buy or sell for
	*@param _tokenAmount token amount to sell or buy
	*@param _isBuy if swap transaction to buy DAI or sell DAI
	*@param _minDAIAmount minimum DAI amount to get in swap transaction if transaction is buy
	*@param _minTokenReturn minimum token amount to get in swap transaction if transaction is sell
	*@param _receiver receiver of tokens after swap transaction
	 */
	function _uniswapSwap(
		Uniswap _uniswapContract,
		ERC20 _token,
		uint256 _tokenAmount,
		bool _isBuy,
		uint256 _minDAIAmount,
		uint256 _minTokenReturn,
		address _receiver
	) internal returns (uint256[] memory) {
		address[] memory path = new address[](2);

		uint256[] memory swap;
		if (address(_token) == address(0x0)) {
			path[0] = daiAddress;
			path[1] = _uniswapContract.WETH();
			swap = _uniswapContract.swapExactTokensForETH(
				_tokenAmount,
				_minTokenReturn,
				path,
				_receiver,
				block.timestamp
			);
			return swap;
		} else {
			path[0] = _isBuy ? address(_token) : daiAddress;
			path[1] = _isBuy ? daiAddress : address(_token);
			swap = _uniswapContract.swapExactTokensForTokens(
				_tokenAmount,
				_isBuy ? _minDAIAmount : _minTokenReturn,
				path,
				_receiver,
				block.timestamp
			);
			return swap;
		}
	}
}
