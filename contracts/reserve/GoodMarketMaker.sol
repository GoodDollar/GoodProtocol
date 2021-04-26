// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../utils/DSMath.sol";
import "../utils/BancorFormula.sol";
import "../DAOStackInterfaces.sol";
import "../Interfaces.sol";
import "../utils/NameService.sol";

/**
@title Dynamic reserve ratio market maker
*/
contract GoodMarketMaker is Initializable, DSMath {
	using SafeMathUpgradeable for uint256;

	// Entity that holds a reserve token
	struct ReserveToken {
		// Determines the reserve token balance
		// that the reserve contract holds
		uint256 reserveSupply;
		// Determines the current ratio between
		// the reserve token and the GD token
		uint32 reserveRatio;
		// How many GD tokens have been minted
		// against that reserve token
		uint256 gdSupply;
		//last time reserve ratio was expanded
		uint256 lastExpansion;
	}

	// The map which holds the reserve token entities
	mapping(address => ReserveToken) public reserveTokens;

	NameService public nameService;

	// Emits when a change has occurred in a
	// reserve balance, i.e. buy / sell will
	// change the balance
	event BalancesUpdated(
		// The account who initiated the action
		address indexed caller,
		// The address of the reserve token
		address indexed reserveToken,
		// The incoming amount
		uint256 amount,
		// The return value
		uint256 returnAmount,
		// The updated total supply
		uint256 totalSupply,
		// The updated reserve balance
		uint256 reserveBalance
	);

	// Emits when the ratio changed. The caller should be the Avatar by definition
	event ReserveRatioUpdated(
		address indexed caller,
		uint256 nom,
		uint256 denom
	);

	// Emits when new tokens should be minted
	// as a result of incoming interest.
	// That event will be emitted after the
	// reserve entity has been updated
	event InterestMinted(
		// The account who initiated the action
		address indexed caller,
		// The address of the reserve token
		address indexed reserveToken,
		// How much new reserve tokens been
		// added to the reserve balance
		uint256 addInterest,
		// The GD supply in the reserve entity
		// before the new minted GD tokens were
		// added to the supply
		uint256 oldSupply,
		// The number of the new minted GD tokens
		uint256 mint
	);

	// Emits when new tokens should be minted
	// as a result of a reserve ratio expansion
	// change. This change should have occurred
	// on a regular basis. That event will be
	// emitted after the reserve entity has been
	// updated
	event UBIExpansionMinted(
		// The account who initiated the action
		address indexed caller,
		// The address of the reserve token
		address indexed reserveToken,
		// The reserve ratio before the expansion
		uint256 oldReserveRatio,
		// The GD supply in the reserve entity
		// before the new minted GD tokens were
		// added to the supply
		uint256 oldSupply,
		// The number of the new minted GD tokens
		uint256 mint
	);

	// Defines the daily change in the reserve ratio in RAY precision.
	// In the current release, only global ratio expansion is supported.
	// That will be a part of each reserve token entity in the future.
	uint256 public reserveRatioDailyExpansion;

	//goodDollar token decimals
	uint256 decimals;

	/**
	 * @dev Constructor
	 * @param _nom The numerator to calculate the global `reserveRatioDailyExpansion` from
	 * @param _denom The denominator to calculate the global `reserveRatioDailyExpansion` from
	 */
	function initialize(
		NameService _ns,
		uint256 _nom,
		uint256 _denom
	) public virtual initializer {
		reserveRatioDailyExpansion = rdiv(_nom, _denom);
		decimals = 2;
		nameService = _ns;
	}

	function _onlyActiveToken(ERC20 _token) internal view {
		ReserveToken storage rtoken = reserveTokens[address(_token)];
		require(rtoken.gdSupply > 0, "Reserve token not initialized");
	}

	function _onlyReserveOrAvatar() internal view {
		require(
			nameService.addresses(nameService.RESERVE()) == msg.sender ||
				nameService.addresses(nameService.AVATAR()) == msg.sender,
			"GoodMarketMaker: not Reserve or Avatar"
		);
	}

	function getBancor() public view returns (BancorFormula) {
		return BancorFormula(nameService.getAddress("BANCOR_FORMULA"));
	}

	/**
	 * @dev Allows the DAO to change the daily expansion rate
	 * it is calculated by _nom/_denom with e27 precision. Emits
	 * `ReserveRatioUpdated` event after the ratio has changed.
	 * Only Avatar can call this method.
	 * @param _nom The numerator to calculate the global `reserveRatioDailyExpansion` from
	 * @param _denom The denominator to calculate the global `reserveRatioDailyExpansion` from
	 */
	function setReserveRatioDailyExpansion(uint256 _nom, uint256 _denom)
		public
	{
		_onlyReserveOrAvatar();
		require(_denom > 0, "denominator must be above 0");
		reserveRatioDailyExpansion = rdiv(_nom, _denom);
		emit ReserveRatioUpdated(msg.sender, _nom, _denom);
	}

	// NOTICE: In the current release, if there is a wish to add another reserve token,
	//  `end` method in the reserve contract should be called first. Then, the DAO have
	//  to deploy a new reserve contract that will own the market maker. A scheme for
	// updating the new reserve must be deployed too.

	/**
	 * @dev Initialize a reserve token entity with the given parameters
	 * @param _token The reserve token
	 * @param _gdSupply Initial supply of GD to set the price
	 * @param _tokenSupply Initial supply of reserve token to set the price
	 * @param _reserveRatio The starting reserve ratio
	 */
	function initializeToken(
		ERC20 _token,
		uint256 _gdSupply,
		uint256 _tokenSupply,
		uint32 _reserveRatio
	) public {
		_onlyReserveOrAvatar();
		reserveTokens[address(_token)] = ReserveToken({
			gdSupply: _gdSupply,
			reserveSupply: _tokenSupply,
			reserveRatio: _reserveRatio,
			lastExpansion: block.timestamp
		});
	}

	/**
	 * @dev Calculates how much to decrease the reserve ratio for _token by
	 * the `reserveRatioDailyExpansion`
	 * @param _token The reserve token to calculate the reserve ratio for
	 * @return The new reserve ratio
	 */
	function calculateNewReserveRatio(ERC20 _token)
		public
		view
		returns (uint32)
	{
		ReserveToken memory reserveToken = reserveTokens[address(_token)];
		uint256 ratio = uint256(reserveToken.reserveRatio);
		if (ratio == 0) {
			ratio = 1e6;
		}
		ratio = ratio.mul(1e21); //expand to e27 precision

		uint256 daysPassed =
			block.timestamp.sub(reserveToken.lastExpansion) / 1 days;
		for (uint256 i = 0; i < daysPassed; i++) {
			ratio = rmul(ratio, reserveRatioDailyExpansion);
		}

		return uint32(ratio.div(1e21)); // return to e6 precision
	}

	/**
	 * @dev Decreases the reserve ratio for _token by the `reserveRatioDailyExpansion`
	 * @param _token The token to change the reserve ratio for
	 * @return The new reserve ratio
	 */
	function expandReserveRatio(ERC20 _token) public returns (uint32) {
		_onlyReserveOrAvatar();
		_onlyActiveToken(_token);
		ReserveToken storage reserveToken = reserveTokens[address(_token)];
		uint32 ratio = reserveToken.reserveRatio;
		if (ratio == 0) {
			ratio = 1e6;
		}
		reserveToken.reserveRatio = calculateNewReserveRatio(_token);

		//set last expansion to begining of expansion day
		reserveToken.lastExpansion =
			block.timestamp -
			(block.timestamp.sub(reserveToken.lastExpansion) % 1 days);
		return reserveToken.reserveRatio;
	}

	/**
	 * @dev Calculates the buy return in GD according to the given _tokenAmount
	 * @param _token The reserve token buying with
	 * @param _tokenAmount The amount of reserve token buying with
	 * @return Number of GD that should be given in exchange as calculated by the bonding curve
	 */
	function buyReturn(ERC20 _token, uint256 _tokenAmount)
		public
		view
		returns (uint256)
	{
		ReserveToken memory rtoken = reserveTokens[address(_token)];
		return
			getBancor().calculatePurchaseReturn(
				rtoken.gdSupply,
				rtoken.reserveSupply,
				rtoken.reserveRatio,
				_tokenAmount
			);
	}

	/**
	 * @dev Calculates the sell return in _token according to the given _gdAmount
	 * @param _token The desired reserve token to have
	 * @param _gdAmount The amount of GD that are sold
	 * @return Number of tokens that should be given in exchange as calculated by the bonding curve
	 */
	function sellReturn(ERC20 _token, uint256 _gdAmount)
		public
		view
		returns (uint256)
	{
		ReserveToken memory rtoken = reserveTokens[address(_token)];
		return
			getBancor().calculateSaleReturn(
				rtoken.gdSupply,
				rtoken.reserveSupply,
				rtoken.reserveRatio,
				_gdAmount
			);
	}

	/**
	 * @dev Updates the _token bonding curve params. Emits `BalancesUpdated` with the
	 * new reserve token information.
	 * @param _token The reserve token buying with
	 * @param _tokenAmount The amount of reserve token buying with
	 * @return (gdReturn) Number of GD that will be given in exchange as calculated by the bonding curve
	 */
	function buy(ERC20 _token, uint256 _tokenAmount) public returns (uint256) {
		_onlyReserveOrAvatar();
		_onlyActiveToken(_token);

		uint256 gdReturn = buyReturn(_token, _tokenAmount);
		ReserveToken storage rtoken = reserveTokens[address(_token)];
		rtoken.gdSupply = rtoken.gdSupply.add(gdReturn);
		rtoken.reserveSupply = rtoken.reserveSupply.add(_tokenAmount);
		emit BalancesUpdated(
			msg.sender,
			address(_token),
			_tokenAmount,
			gdReturn,
			rtoken.gdSupply,
			rtoken.reserveSupply
		);
		return gdReturn;
	}

	/**
	 * @dev Calculates the sell return with contribution in _token and update the bonding curve params.
	 * Emits `BalancesUpdated` with the new reserve token information.
	 * @param _token The desired reserve token to have
	 * @param _gdAmount The amount of GD that are sold
	 * @param _contributionGdAmount The number of GD tokens that will not be traded for the reserve token
	 * @return Number of tokens that will be given in exchange as calculated by the bonding curve
	 */
	function sellWithContribution(
		ERC20 _token,
		uint256 _gdAmount,
		uint256 _contributionGdAmount
	) public returns (uint256) {
		_onlyReserveOrAvatar();
		_onlyActiveToken(_token);

		require(
			_gdAmount >= _contributionGdAmount,
			"GD amount is lower than the contribution amount"
		);
		ReserveToken storage rtoken = reserveTokens[address(_token)];
		require(
			rtoken.gdSupply > _gdAmount,
			"GD amount is higher than the total supply"
		);

		// Deduces the convertible amount of GD tokens by the given contribution amount
		uint256 amountAfterContribution = _gdAmount.sub(_contributionGdAmount);

		// The return value after the deduction
		uint256 tokenReturn = sellReturn(_token, amountAfterContribution);
		rtoken.gdSupply = rtoken.gdSupply.sub(_gdAmount);
		rtoken.reserveSupply = rtoken.reserveSupply.sub(tokenReturn);
		emit BalancesUpdated(
			msg.sender,
			address(_token),
			_contributionGdAmount,
			tokenReturn,
			rtoken.gdSupply,
			rtoken.reserveSupply
		);
		return tokenReturn;
	}

	/**
	 * @dev Current price of GD in `token`. currently only cDAI is supported.
	 * @param _token The desired reserve token to have
	 * @return price of GD
	 */
	function currentPrice(ERC20 _token) public view returns (uint256) {
		ReserveToken memory rtoken = reserveTokens[address(_token)];
		return
			getBancor().calculateSaleReturn(
				rtoken.gdSupply,
				rtoken.reserveSupply,
				rtoken.reserveRatio,
				(10**decimals)
			);
	}

	//TODO: need real calculation and tests
	/**
	 * @dev Calculates how much G$ to mint based on added token supply (from interest)
	 * and on current reserve ratio, in order to keep G$ price the same at the bonding curve
	 * formula to calculate the gd to mint: gd to mint =
	 * addreservebalance * (gdsupply / (reservebalance * reserveratio))
	 * @param _token the reserve token
	 * @param _addTokenSupply amount of token added to supply
	 * @return how much to mint in order to keep price in bonding curve the same
	 */
	function calculateMintInterest(ERC20 _token, uint256 _addTokenSupply)
		public
		view
		returns (uint256)
	{
		uint256 decimalsDiff = uint256(27).sub(decimals);
		//resulting amount is in RAY precision
		//we divide by decimalsdiff to get precision in GD (2 decimals)
		return
			rdiv(_addTokenSupply, currentPrice(_token)).div(10**decimalsDiff);
	}

	/**
	 * @dev Updates bonding curve based on _addTokenSupply and new minted amount
	 * @param _token The reserve token
	 * @param _addTokenSupply Amount of token added to supply
	 * @return How much to mint in order to keep price in bonding curve the same
	 */
	function mintInterest(ERC20 _token, uint256 _addTokenSupply)
		public
		returns (uint256)
	{
		_onlyReserveOrAvatar();
		_onlyActiveToken(_token);
		if (_addTokenSupply == 0) {
			return 0;
		}
		uint256 toMint = calculateMintInterest(_token, _addTokenSupply);
		ReserveToken storage reserveToken = reserveTokens[address(_token)];
		uint256 gdSupply = reserveToken.gdSupply;
		uint256 reserveBalance = reserveToken.reserveSupply;
		reserveToken.gdSupply = gdSupply.add(toMint);
		reserveToken.reserveSupply = reserveBalance.add(_addTokenSupply);
		emit InterestMinted(
			msg.sender,
			address(_token),
			_addTokenSupply,
			gdSupply,
			toMint
		);
		return toMint;
	}

	/**
	 * @dev Calculate how much G$ to mint based on expansion change (new reserve
	 * ratio), in order to keep G$ price the same at the bonding curve. the
	 * formula to calculate the gd to mint: gd to mint =
	 * (reservebalance / (newreserveratio * currentprice)) - gdsupply
	 * @param _token The reserve token
	 * @return How much to mint in order to keep price in bonding curve the same
	 */
	function calculateMintExpansion(ERC20 _token)
		public
		view
		returns (uint256)
	{
		ReserveToken memory reserveToken = reserveTokens[address(_token)];
		uint32 newReserveRatio = calculateNewReserveRatio(_token); // new reserve ratio
		uint256 reserveDecimalsDiff = uint256(27).sub(_token.decimals()); // //result is in RAY precision
		uint256 denom =
			rmul(
				uint256(newReserveRatio).mul(1e21),
				currentPrice(_token).mul(10**reserveDecimalsDiff)
			); // (newreserveratio * currentprice) in RAY precision
		uint256 gdDecimalsDiff = uint256(27).sub(decimals);
		uint256 toMint =
			rdiv(
				reserveToken.reserveSupply.mul(10**reserveDecimalsDiff), // reservebalance in RAY precision
				denom
			)
				.div(10**gdDecimalsDiff); // return to gd precision
		return toMint.sub(reserveToken.gdSupply);
	}

	/** @dev Calculate new reserve ratio in order to mint X G$
	 * keeping G$ price the same at the bonding curve. the
	 * formula to calculate the gd to mint: gd to mint =
	 * (reservebalance / (newreserveratio * currentprice)) - gdsupply
	 * @param _token The reserve token
	 * @param _gdToMint The amount to mint
	 * @return new reserve ratio
	 */
	function calculateMintFromReserveRatio(ERC20 _token, uint256 _gdToMint)
		public
		view
		returns (uint32)
	{
		return 80000;
	}

	/**
	 * @dev Updates bonding curve based on expansion change and new minted amount
	 * @param _token The reserve token
	 * @return How much to mint in order to keep price in bonding curve the same
	 */
	function mintExpansion(ERC20 _token) public returns (uint256) {
		_onlyReserveOrAvatar();
		_onlyActiveToken(_token);
		uint256 toMint = calculateMintExpansion(_token);
		ReserveToken storage reserveToken = reserveTokens[address(_token)];
		uint256 gdSupply = reserveToken.gdSupply;
		uint256 ratio = reserveToken.reserveRatio;
		reserveToken.gdSupply = gdSupply.add(toMint);
		expandReserveRatio(_token);
		emit UBIExpansionMinted(
			msg.sender,
			address(_token),
			ratio,
			gdSupply,
			toMint
		);
		return toMint;
	}

	function mintFromReserveRatio(ERC20 _token, uint256 _gdToMint) public {
		_onlyReserveOrAvatar();
		_onlyActiveToken(_token);

		uint32 newRR = calculateMintFromReserveRatio(_token, _gdToMint);
		ReserveToken storage reserveToken = reserveTokens[address(_token)];
		reserveToken.reserveRatio = newRR;
		reserveToken.gdSupply += _gdToMint;
	}
}
