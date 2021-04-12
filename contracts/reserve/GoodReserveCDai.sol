// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/cryptography/MerkleProofUpgradeable.sol";

import "../utils/DSMath.sol";
import "../utils/DAOContract.sol";
import "../utils/NameService.sol";
import "../DAOStackInterfaces.sol";
import "../Interfaces.sol";
import "./GoodMarketMaker.sol";

interface ContributionCalc {
	function calculateContribution(
		GoodMarketMaker _marketMaker,
		GoodReserveCDai _reserve,
		address _contributer,
		ERC20 _token,
		uint256 _gdAmount
	) external view returns (uint256);
}

/**
@title Reserve based on cDAI and dynamic reserve ratio market maker
*/

//TODO: feeless scheme, active period
contract GoodReserveCDai is
	Initializable,
	DAOContract,
	DSMath,
	ERC20PresetMinterPauserUpgradeable
{
	using SafeMathUpgradeable for uint256;

	// The last block number which
	// `mintInterestAndUBI` has been executed in
	uint256 public lastMinted;

	// The contribution contract is responsible
	// for calculates the contribution amount
	// when selling GD
	// ContributionCalc public contribution;

	NameService public nameService;
	//Struct to prevent stack too deep errors
	struct SellParams{
		ERC20 sellTo;
		uint256 gdAmount;
		uint256 minReturn;
		bool returnInCDai;
		
	}
	/// @dev merkleroot
	bytes32 public gdxAirdrop;

	mapping(address => bool) public isClaimedGDX;

	modifier onlyFundManager {
		require(
			msg.sender == nameService.getAddress("FUND_MANAGER"),
			"Only FundManager can call this method"
		);
		_;
	}

	// Emits when GD tokens are purchased
	event TokenPurchased(
		// The initiate of the action
		address indexed caller,
		// The convertible token address
		// which the GD tokens were
		// purchased with
		address indexed reserveToken,
		// Reserve tokens amount
		uint256 reserveAmount,
		// Minimal GD return that was
		// permitted by the caller
		uint256 minReturn,
		// Actual return after the
		// conversion
		uint256 actualReturn
	);

	// Emits when GD tokens are sold
	event TokenSold(
		// The initiate of the action
		address indexed caller,
		// The convertible token address
		// which the GD tokens were
		// sold to
		address indexed reserveToken,
		// GD tokens amount
		uint256 gdAmount,
		// The amount of GD tokens that
		// was contributed during the
		// conversion
		uint256 contributionAmount,
		// Minimal reserve tokens return
		// that was permitted by the caller
		uint256 minReturn,
		// Actual return after the
		// conversion
		uint256 actualReturn
	);

	// Emits when new GD tokens minted
	event UBIMinted(
		//epoch of UBI
		uint256 indexed day,
		//the token paid as interest
		address indexed interestToken,
		//wei amount of interest paid in interestToken
		uint256 interestReceived,
		// Amount of GD tokens that was
		// added to the supply as a result
		// of `mintInterest`
		uint256 gdInterestMinted,
		// Amount of GD tokens that was
		// added to the supply as a result
		// of `mintExpansion`
		uint256 gdExpansionMinted,
		// Amount of GD tokens that was
		// minted to the `interestCollector`
		uint256 gdInterestTransferred,
		// Amount of GD tokens that was
		// minted to the `ubiCollector`
		uint256 gdUbiTransferred
	);

	function initialize(
		Controller _dao,
		NameService _ns,
		bytes32 _gdxAirdrop
	) public virtual initializer {
		__ERC20PresetMinterPauser_init("GDX", "G$X");
		setDAO(_dao);
		gdxAirdrop = _gdxAirdrop;
		nameService = _ns;
	}

	/// @dev GDX decimals
	function decimals() public view override returns (uint8) {
		return 2;
	}

	// /**
	//  * @dev Constructor
	//  * @param _dai The address of DAI
	//  * @param _cDai The address of cDAI
	//  * @param _fundManager The address of the fund manager contract
	//  * @param _dao The Controller of the DAO
	//  * @param _marketMaker The address of the market maker contract
	//  * @param _contribution The address of the contribution contract
	//  * @param _blockInterval How many blocks should be passed before the next execution of `mintInterestAndUBI`
	//  */
	// constructor(
	// 	ERC20 _dai,
	// 	cERC20 _cDai,
	// 	address _fundManager,
	// 	Controller _dao,
	// 	address _marketMaker,
	// 	ContributionCalc _contribution,
	// 	uint256 _blockInterval
	// ) {
	// 	//TODO: move to ens?
	// 	dai = _dai;
	// 	cDai = _cDai;
	// 	fundManager = _fundManager;
	// 	marketMaker = GoodMarketMaker(_marketMaker);
	// 	blockInterval = _blockInterval;
	// 	lastMinted = block.number.div(blockInterval);
	// 	contribution = _contribution;
	// 	dao = _dao;
	// 	avatar = dao.avatar();
	// }

	//TODO:
	// /**
	//  * @dev Start function. Adds this contract to identity as a feeless scheme.
	//  * Can only be called if scheme is registered
	//  */
	// function start() public onlyRegistered {
	// 	addRights();

	// 	// Adds the reserve as a minter of the GD token
	// 	controller.genericCall(
	// 		address(avatar.nativeToken()),
	// 		abi.encodeWithSignature("addMinter(address)", address(this)),
	// 		avatar,
	// 		0
	// 	);
	// 	super.start();
	// }

	/**
	 * @dev Start function. Adds this contract to identity as a feeless scheme.
	 * Can only be called if scheme is registered
	 */
	function start() public {
		// Adds the reserve as a minter of the GD token
		dao.genericCall(
			address(avatar.nativeToken()),
			abi.encodeWithSignature("addMinter(address)", address(this)),
			avatar,
			0
		);
	}

	/**
	 * @dev get current FundManager from name service
	 */
	function getFundManager() public view returns (address) {
		return nameService.getAddress("FUND_MANAGER");
	}

	//
	/**
	 * @dev get current MarketMaker from name service
	 * The address of the market maker contract
	 * which makes the calculations and holds
	 * the token and accounts info (should be owned by the reserve)
	 */
	function getMarketMaker() public view returns (GoodMarketMaker) {
		return GoodMarketMaker(nameService.getAddress("MARKET_MAKER"));
	}
	/**
	@dev Converts any 'buyWith' tokens to cDAI then call buy function to convert it to GD tokens
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
	) public returns(uint256){
		require(
				_buyWith.allowance(msg.sender, address(this)) >= _tokenAmount,
				"You need to approve input token transfer first"
			);
			require(
				_buyWith.transferFrom(msg.sender, address(this), _tokenAmount) ==
					true,
				"transferFrom failed, make sure you approved input token transfer"
			);
		address cDaiAddress = nameService.getAddress("CDAI");
		address daiAddress = nameService.getAddress("DAI");
		uint256 tempMinReturn = _minReturn;
		address tempTargetAddress = _targetAddress;
		if (address(_buyWith) == cDaiAddress) return _buy( _tokenAmount, _minReturn, _targetAddress);
		if (address(_buyWith) == daiAddress){
			
			cERC20 cDai = cERC20(cDaiAddress);
			// Approve transfer to cDAI contract
			_buyWith.approve(address(cDai),_tokenAmount);
			uint256 currCDaiBalance = cDai.balanceOf(address(this));
			
			
			//Mint cDAIs
			uint256 cDaiResult = cDai.mint(_tokenAmount);
			// Get input value for cDAI
			uint256 cDaiInput = (cDai.balanceOf(address(this))).sub(currCDaiBalance);
			return _buy(cDaiInput, _minReturn, _targetAddress);
		} else {
			
			address[] memory path = new address[](2);
			path[0] = address(_buyWith);
			path[1] = daiAddress;
			Uniswap uniswapContract = Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
			_buyWith.approve(address(uniswapContract), _tokenAmount);
			uint256[] memory swap = uniswapContract.swapExactTokensForTokens(
					_tokenAmount,
					_minDAIAmount,
					path,
					address(this),
					block.timestamp
				);

			uint256 dai = swap[1];
			require(dai > 0, "token selling failed");
			
			cERC20 cDai = cERC20(cDaiAddress);
			// Approve transfer to cDAI contract
			ERC20(daiAddress).approve(address(cDai),dai);
			
			uint256 currCDaiBalance = cDai.balanceOf(address(this));
			
			//Mint cDAIs
			uint256 cDaiResult = cDai.mint(dai);
			
			uint256 cDaiInput = (cDai.balanceOf(address(this))).sub(currCDaiBalance);
			return _buy(cDaiInput, tempMinReturn, tempTargetAddress);

		}
		

	}
	
	/**
	 * @dev Converts `buyWith` tokens to GD tokens and updates the bonding curve params.
	 * `buy` occurs only if the GD return is above the given minimum. It is possible
	 * to buy only with cDAI and when the contract is set to active. MUST call to
	 * `buyWith` `approve` prior this action to allow this contract to accomplish the
	 * conversion.
	 * @param _tokenAmount The amount of `buyWith` tokens that should be converted to GD tokens
	 * @param _minReturn The minimum allowed return in GD tokens
	 * @param _targetAddress address of g$ and gdx recipient if different than msg.sender
	 * @return (gdReturn) How much GD tokens were transferred
	 */
	function _buy(
		uint256 _tokenAmount,
		uint256 _minReturn,
		address _targetAddress
	) internal returns (uint256) {
		ERC20 buyWith = ERC20(nameService.getAddress("CDAI"));
		uint256 gdReturn = getMarketMaker().buy(buyWith, _tokenAmount);
		require(
			gdReturn >= _minReturn,
			"GD return must be above the minReturn"
		);
		
		address receiver = _targetAddress == address(0x0) ? msg.sender : _targetAddress;
		//mint GDX
		GoodDollar(address(avatar.nativeToken())).mint(receiver, gdReturn);
		_mint(receiver, gdReturn);
		
		

		emit TokenPurchased(
			msg.sender,
			address(buyWith),
			_tokenAmount,
			_minReturn,
			gdReturn
		);
		return gdReturn;
	}
	/**
	 * @dev Converts GD tokens to `sellTo` tokens and update the bonding curve params.
	 * `sell` occurs only if the token return is above the given minimum. Notice that
	 * there is a contribution amount from the given GD that remains in the reserve.
	 * It is only possible to sell to cDAI and only when the contract is set to
	 * active. MUST be called to G$ `approve` prior to this action to allow this
	 * contract to accomplish the conversion.
	 * @param _sellTo The tokens that will be received after the conversion
	 * @param _gdAmount The amount of GD tokens that should be converted to `_sellTo` tokens
	 * @param _minReturn The minimum allowed `sellTo` tokens return
	 * @param _minTokenAmount The mininmum dai out amount from Exchange swap function
	 * @param _targetAddress address of _sellTo token recipient if different than msg.sender
	 * @return (tokenReturn) How much `sellTo` tokens were transferred
	 */
	function sell(
		ERC20 _sellTo,
		uint256 _gdAmount,
		uint256 _minReturn,
		uint256 _minTokenAmount,
		address _targetAddress
	) public returns (uint256) {
		
		address cDaiAddress = nameService.getAddress("CDAI");
		address daiAddress = nameService.getAddress("DAI");
		address receiver = _targetAddress == address(0x0) ? msg.sender : _targetAddress;
		// redeclarations to prevent stack too deep errors
		ERC20 tempSellTo = _sellTo;
		uint256 tempMinReturn = _minReturn;
		uint256 tempGdAmount = _gdAmount;
		uint tempMinTokenAmount = _minTokenAmount;
		uint256 result;
		uint256 contributionAmount;
		if(address(_sellTo) == cDaiAddress || address(_sellTo) == daiAddress){
			(result,contributionAmount) = _sell(_gdAmount, _minReturn, address(tempSellTo) == cDaiAddress);
			tempMinReturn = 0;
			
		} else {
			uint256 returnAmount;
			(returnAmount,contributionAmount) = _sell(_gdAmount, _minReturn, false);
			address[] memory path = new address[](2);
			path[0] = daiAddress;
			path[1] = address(tempSellTo);
			Uniswap uniswapContract = Uniswap(nameService.getAddress("UNISWAP_ROUTER"));
			ERC20(daiAddress).approve(address(uniswapContract), returnAmount);
			uint256[] memory swap = uniswapContract.swapExactTokensForTokens(
					returnAmount,
					tempMinTokenAmount,
					path,
					address(this),
					block.timestamp
				);
			tempMinReturn = tempMinTokenAmount;
			result = swap[1];
			require(result > 0, "token selling failed");
			
			
			
		}
		require(
			result >= tempMinReturn,
			"Token return must be above the minReturn"
		);
		require(
			tempSellTo.transfer(receiver, result) == true,
			"Transfer failed"
		);
		emit TokenSold(
			receiver,
			address(tempSellTo),
			tempGdAmount,
			contributionAmount,
			tempMinReturn,
			result
		);
		return result;
	}
	

	/**
	 * @dev Converts GD tokens to `sellTo` tokens and update the bonding curve params.
	 * `sell` occurs only if the token return is above the given minimum. Notice that
	 * there is a contribution amount from the given GD that remains in the reserve.
	 * It is only possible to sell to cDAI and only when the contract is set to
	 * active. MUST be called to G$ `approve` prior to this action to allow this
	 * contract to accomplish the conversion.
	 * @param _gdAmount The amount of GD tokens that should be converted to `_sellTo` tokens
	 * @param _minReturn The minimum allowed `sellTo` tokens return
	 * @param _returnInCDai bool for if return token is cDai or DAI
	 * @return (tokenReturn) How much `sellTo` tokens were transferred
	 */
	function _sell(
		uint256 _gdAmount,
		uint256 _minReturn,
		bool _returnInCDai
		) internal returns (uint256,uint256) {
		ERC20 sellTo = ERC20(nameService.getAddress("CDAI"));
		GoodDollar(address(avatar.nativeToken())).burnFrom(
			msg.sender,
			_gdAmount
		);
		SellParams memory sellParameters = SellParams(sellTo, _gdAmount, _minReturn, _returnInCDai);
		//discount on exit contribution based on gdx
		uint256 gdx = balanceOf(msg.sender);
		uint256 discount = min(gdx, _gdAmount);

		//burn gdx used for discount
		burn(discount);

		
		uint256 contributionAmount =
			discount >= _gdAmount
				? 0
				: ContributionCalc(
					nameService.getAddress("CONTRIBUTION_CALCULATION")
				)
					.calculateContribution(
					getMarketMaker(),
					this,
					msg.sender,
					sellParameters.sellTo,
					sellParameters.gdAmount.sub(discount)
				);

		uint256 tokenReturn =
			getMarketMaker().sellWithContribution(
				sellParameters.sellTo,
				sellParameters.gdAmount,
				contributionAmount
		);
		require(
			tokenReturn >= sellParameters.minReturn,
			"Token return must be above the minReturn"
		);
		if(_returnInCDai == true){
			
			return (tokenReturn, contributionAmount);

		} else {
			cERC20 cDai = cERC20(nameService.getAddress("CDAI"));
			ERC20 dai = ERC20(nameService.getAddress("DAI"));
			
			uint256 currDaiBalance = dai.balanceOf(address(this));
			
			uint256 daiResult = cDai.redeem(tokenReturn);
			uint256 daiReturnAmount = (dai.balanceOf(address(this))).sub(currDaiBalance);
			
			return (daiReturnAmount, contributionAmount);
			
			}
	}
	/**
	 * @dev Current price of GD in `token`. currently only cDAI is supported.
	 * @param _token The desired reserve token to have
	 * @return price of GD
	 */
	function currentPrice(ERC20 _token) public view returns (uint256) {
		return getMarketMaker().currentPrice(_token);
	}

	function currentPrice() public view returns (uint256) {
		return
			getMarketMaker().currentPrice(
				ERC20(nameService.getAddress("CDAI"))
			);
	}

	//TODO: can we send directly to UBI via bridge here?
	/**
	 * @dev only FundManager can call this to trigger minting.
	 * Reserve sends UBI + interest to FundManager.
	 * @param _interestToken The token that was transfered to the reserve
	 * @param _transfered How much was transfered to the reserve for UBI in `_interestToken`
	 * @param _interest Out of total transfered how much is the interest (in `_interestToken`)
	 * that needs to be paid back (some interest might be donated)
	 * @return (gdInterest, gdUBI) How much GD interest was minted and how much GD UBI was minted
	 */
	function mintInterestAndUBI(
		ERC20 _interestToken,
		uint256 _transfered,
		uint256 _interest
	) public onlyFundManager returns (uint256, uint256) {
		uint256 price = currentPrice(_interestToken);
		uint256 gdInterestToMint =
			getMarketMaker().mintInterest(_interestToken, _transfered);
		GoodDollar gooddollar = GoodDollar(address(avatar.nativeToken()));
		uint256 precisionLoss = uint256(27).sub(uint256(gooddollar.decimals()));
		uint256 gdInterest = rdiv(_interest, price).div(10**precisionLoss);
		uint256 gdExpansionToMint =
			getMarketMaker().mintExpansion(_interestToken);
		uint256 gdUBI = gdInterestToMint.sub(gdInterest);
		gdUBI = gdUBI.add(gdExpansionToMint);
		uint256 toMint = gdUBI.add(gdInterest);
		GoodDollar(address(avatar.nativeToken())).mint(
			getFundManager(),
			toMint
		);
		lastMinted = block.number;
		emit UBIMinted(
			lastMinted,
			address(_interestToken),
			_transfered,
			gdInterestToMint,
			gdExpansionToMint,
			gdInterest,
			gdUBI
		);
		return (gdInterest, gdUBI);
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
		onlyAvatar
	{
		getMarketMaker().setReserveRatioDailyExpansion(_nom, _denom);
	}

	/**
	 * @dev Making the contract inactive after it has transferred the cDAI funds to `_avatar`
	 * and has transferred the market maker ownership to `_avatar`. Inactive means that
	 * buy / sell / mintInterestAndUBI actions will no longer be active. Only the Avatar can
	 * executes this method
	 */
	function end() public onlyAvatar {
		// remaining cDAI tokens in the current reserve contract
		cERC20 cDai = cERC20(nameService.getAddress("CDAI"));
		uint256 remainingReserve = cDai.balanceOf(address(this));
		if (remainingReserve > 0) {
			require(
				cDai.transfer(address(avatar), remainingReserve),
				"cdai transfer failed"
			);
		}
		require(
			cDai.balanceOf(address(this)) == 0,
			"Funds transfer has failed"
		);
		GoodDollar gooddollar = GoodDollar(address(avatar.nativeToken()));
		getMarketMaker().transferOwnership(address(avatar));
		gooddollar.renounceMinter();
		//TODO:
		// super.internalEnd(avatar);
	}

	/**
	 * @dev method to recover any stuck erc20 tokens (ie compound COMP)
	 * @param _token the ERC20 token to recover
	 */
	function recover(ERC20 _token) public onlyAvatar {
		require(
			_token.transfer(address(avatar), _token.balanceOf(address(this))),
			"recover transfer failed"
		);
	}

	/// @notice helper function to check merkle proof using openzeppelin
	/// @return leafHash isProofValid tuple (byte32, bool) with the hash of the leaf data we prove and true if proof is valid
	function _checkMerkleProof(
		address _user,
		uint256 _balance,
		bytes32 _root,
		bytes32[] memory _proof
	) internal pure returns (bytes32 leafHash, bool isProofValid) {
		leafHash = keccak256(abi.encode(_user, _balance));
		isProofValid = MerkleProofUpgradeable.verify(_proof, _root, leafHash);
	}

	/**
	 * @notice prove user balance in a specific blockchain state hash
	 * @dev "rootState" is a special state that can be supplied once, and actually mints reputation on the current blockchain
	 * @param _user the user to prove his balance
	 * @param _gdx the balance we are prooving
	 * @param _proof array of byte32 with proof data (currently merkle tree path)
	 * @return true if proof is valid
	 */
	function claimGDX(
		address _user,
		uint256 _gdx,
		bytes32[] memory _proof
	) public returns (bool) {
		require(isClaimedGDX[_user] == false, "already claimed gdx");
		bytes32 leafHash = keccak256(abi.encode(_user, _gdx));
		bool isProofValid =
			MerkleProofUpgradeable.verify(_proof, gdxAirdrop, leafHash);

		require(isProofValid, "invalid merkle proof");

		_mint(_user, _gdx);

		isClaimedGDX[_user] = true;
		return true;
	}
}
