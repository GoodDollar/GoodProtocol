// SPDX-License-Identifier: MIT

pragma solidity >=0.8;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

import "../Interfaces.sol";
import "../ubi/UBIScheme.sol";

// import "hardhat/console.sol";

interface IConsensus {
	/**
	 * @dev delegate to a validator
	 * @param _validator the address of the validator msg.sender is delegating to
	 */
	function delegate(address _validator) external payable;

	/**
	 * @dev Function to be called when a delegator whishes to withdraw some of his staked funds for a validator
	 * @param _validator the address of the validator msg.sender has delegating to
	 * @param _amount the amount msg.sender wishes to withdraw from the contract
	 */
	function withdraw(address _validator, uint256 _amount) external;

	function delegatedAmount(address _address, address _validator)
		external
		view
		returns (uint256);

	function stakeAmount(address _address) external view returns (uint256);

	function delegators(address _validator)
		external
		view
		returns (address[] memory);
}

interface PegSwap {
	/**
	 * @notice exchanges the source token for target token
	 * @param sourceAmount count of tokens being swapped
	 * @param source the token that is being given
	 * @param target the token that is being taken
	 */
	function swap(
		uint256 sourceAmount,
		address source,
		address target
	) external;
}

contract FuseStakingV3 is Initializable, OwnableUpgradeable {
	using SafeMathUpgradeable for uint256;

	mapping(address => uint256) public stakers;
	address[] public validators;

	IConsensus public consensus;

	Uniswap public uniswap;
	IGoodDollar public GD;
	UBIScheme public ubischeme;
	UniswapFactory public uniswapFactory;
	UniswapPair public uniswapPair;

	uint256 public lastDayCollected; //ubi day from ubischeme

	uint256 public stakeBackRatio;
	uint256 public maxSlippageRatio; //actually its max price impact ratio
	uint256 public keeperFeeRatio;
	uint256 public RATIO_BASE;
	uint256 public communityPoolRatio; //out of G$ bought how much should goto pool

	uint256 public communityPoolBalance;
	uint256 public pendingFuseEarnings; //earnings not  used because of slippage

	address public USDC;
	address public fUSD;

	bool public paused;
	address public guardian;

	PegSwap pegSwap;

	event UBICollected(
		uint256 indexed currentDay,
		uint256 ubi, //G$ sent to ubischeme
		uint256 communityPool, //G$ added to pool
		uint256 gdBought, //actual G$ we got out of swapping stakingRewards + pendingFuseEarnings
		uint256 stakingRewards, //rewards earned since previous collection,
		uint256 pendingFuseEarnings, //new balance of fuse pending to be swapped for G$
		address keeper,
		uint256 keeperGDFee
	);

	/**
	 * @dev initialize
	 */
	function initialize(address _uniswap, address _gd) public initializer {
		__Ownable_init_unchained();
		consensus = IConsensus(address(0x3014ca10b91cb3D0AD85fEf7A3Cb95BCAc9c0f79));
		validators.push(address(0xcb876A393F05a6677a8a029f1C6D7603B416C0A6));
		stakeBackRatio = 33333; //%33
		communityPoolRatio = 33333; //%33
		maxSlippageRatio = 3000; //3%
		keeperFeeRatio = 30; //0.03%
		RATIO_BASE = 100000; //100%
		uniswap = Uniswap(
			_uniswap == address(0)
				? 0xE3F85aAd0c8DD7337427B9dF5d0fB741d65EEEB5
				: _uniswap
		);

		GD = IGoodDollar(_gd);
		uniswapFactory = UniswapFactory(uniswap.factory());
		uniswapPair = UniswapPair(uniswapFactory.getPair(uniswap.WETH(), _gd));
		pegSwap = PegSwap(0xdfE016328E7BcD6FA06614fE3AF3877E931F7e0a);
		USDC = address(0x620fd5fa44BE6af63715Ef4E65DDFA0387aD13F5);
		fUSD = address(0x249BE57637D8B013Ad64785404b24aeBaE9B098B);
	}

	modifier notPaused() {
		require(paused == false, "ubi collection is pauased");
		_;
	}

	modifier onlyGuardian() {
		require(msg.sender == guardian, "not guardian");
		_;
	}

	function approve() external {
		cERC20(fUSD).approve(address(pegSwap), type(uint256).max);
		cERC20(USDC).approve(address(uniswap), type(uint256).max);
	}

	function setUBIScheme(address _ubischeme) public onlyOwner {
		ubischeme = UBIScheme(_ubischeme);
	}

	function stake() public payable returns (bool) {
		return stake(address(0));
	}

	function stake(address _validator)
		public
		payable
		onlyGuardian
		returns (bool)
	{
		require(msg.value > 0, "stake must be > 0");
		require(validators.length > 0, "no approved validators");
		bool found;
		for (
			uint256 i = 0;
			_validator != address(0) && i < validators.length;
			i++
		) {
			if (validators[i] != _validator) {
				found = true;
				break;
			}
		}
		require(
			_validator == address(0) || found,
			"validator not in approved list"
		);

		bool staked = stakeNextValidator(msg.value, _validator);
		stakers[msg.sender] += msg.value;
		return staked;
	}

	function balanceOf(address _owner) public view returns (uint256) {
		return stakers[_owner];
	}

	function withdrawAll() public onlyGuardian {
		for (uint256 i = 0; i < validators.length; i++) {
			uint256 cur = consensus.delegatedAmount(address(this), validators[i]);
			if (cur == 0) continue;
			undelegateWithCatch(validators[i], cur);
		}
		uint256 effectiveBalance = balance(); //use only undelegated funds
		pendingFuseEarnings = 0;
		if (effectiveBalance > 0) {
			(bool ok, ) = msg.sender.call{ value: effectiveBalance }("");
			require(ok, "transfer failed");
		}
	}

	function withdraw(uint256 _value) public returns (uint256) {
		uint256 effectiveBalance = balance(); //use only undelegated funds
		uint256 toWithdraw = _value == 0 ? stakers[msg.sender] : _value;
		uint256 toCollect = toWithdraw;
		require(
			toWithdraw > 0 && toWithdraw <= stakers[msg.sender],
			"invalid withdraw amount"
		);
		uint256 perValidator = _value.div(validators.length);
		for (uint256 i = 0; i < validators.length; i++) {
			uint256 cur = consensus.delegatedAmount(address(this), validators[i]);
			if (cur == 0) continue;
			if (cur <= perValidator) {
				undelegateWithCatch(validators[i], cur);
				toCollect = toCollect.sub(cur);
			} else {
				undelegateWithCatch(validators[i], perValidator);
				toCollect = toCollect.sub(perValidator);
			}
			if (toCollect == 0) break;
		}

		effectiveBalance = balance().sub(effectiveBalance); //use only undelegated funds

		// in case some funds where not withdrawn
		if (toWithdraw > effectiveBalance) {
			toWithdraw = effectiveBalance;
		}

		stakers[msg.sender] = stakers[msg.sender].sub(toWithdraw);
		if (toWithdraw > 0) {
			msg.sender.call{ value: toWithdraw }("");
		}
		return toWithdraw;
	}

	function stakeNextValidator(uint256 _value, address _validator)
		internal
		returns (bool)
	{
		if (validators.length == 0) return false;
		if (_validator != address(0)) {
			consensus.delegate{ value: _value }(_validator);
			return true;
		}

		uint256 perValidator = (totalDelegated() + _value) / validators.length;
		uint256 left = _value;
		for (uint256 i = 0; i < validators.length && left > 0; i++) {
			uint256 cur = consensus.delegatedAmount(address(this), validators[i]);

			if (cur < perValidator) {
				uint256 toDelegate = perValidator.sub(cur);
				toDelegate = toDelegate < left ? toDelegate : left;
				consensus.delegate{ value: toDelegate }(validators[i]);
				left = left.sub(toDelegate);
			}
		}

		return true;
	}

	function addValidator(address _v) public onlyOwner {
		validators.push(_v);
	}

	function totalDelegated() public view returns (uint256) {
		uint256 total = 0;
		for (uint256 i = 0; i < validators.length; i++) {
			uint256 cur = consensus.delegatedAmount(address(this), validators[i]);
			total += cur;
		}
		return total;
	}

	function removeValidator(address _validator) public onlyOwner {
		uint256 delegated = consensus.delegatedAmount(address(this), _validator);
		if (delegated > 0) {
			uint256 prevBalance = balance();
			undelegateWithCatch(_validator, delegated);

			// wasnt withdrawn because validator needs to be taken of active validators
			if (balance() == prevBalance) {
				// pendingValidators.push(_validator);
				return;
			}
		}

		for (uint256 i = 0; i < validators.length; i++) {
			if (validators[i] == _validator) {
				if (i < validators.length - 1)
					validators[i] = validators[validators.length - 1];
				validators.pop();
				break;
			}
		}
	}

	function collectUBIInterest() public notPaused {
		uint256 curDay = ubischeme.currentDay();
		require(curDay != lastDayCollected, "can collect only once in a ubi cycle");

		uint256 earnings = balance() - pendingFuseEarnings;
		require(pendingFuseEarnings + earnings > 0, "no earnings to collect");

		lastDayCollected = curDay;
		uint256 fuseUBI = earnings.mul(RATIO_BASE - stakeBackRatio).div(RATIO_BASE);
		uint256 stakeBack = earnings - fuseUBI;

		uint256[] memory fuseswapResult = _buyGD(fuseUBI + pendingFuseEarnings); //buy GD with X% of earnings
		pendingFuseEarnings = fuseUBI + pendingFuseEarnings - fuseswapResult[0];
		stakeNextValidator(stakeBack, address(0)); //stake back the rest of the earnings

		uint256 gdBought = fuseswapResult[fuseswapResult.length - 1];
		uint256 keeperFee = gdBought.mul(keeperFeeRatio).div(RATIO_BASE);
		if (keeperFee > 0) GD.transfer(msg.sender, keeperFee);
		gdBought -= keeperFee;
		uint256 communityPoolContribution = gdBought.mul(communityPoolRatio).div(
			RATIO_BASE
		); //subtract fee // * ommunityPoolRatio // = G$ after fee * communityPoolRatio%

		uint256 ubiAfterFeeAndPool = gdBought.sub(communityPoolContribution);

		GD.transfer(address(ubischeme), ubiAfterFeeAndPool); //transfer to ubischeme
		communityPoolBalance += communityPoolContribution;

		emit UBICollected(
			curDay,
			ubiAfterFeeAndPool,
			communityPoolContribution,
			gdBought,
			earnings,
			pendingFuseEarnings,
			msg.sender,
			keeperFee
		);
	}

	/**
	 * @dev internal method to buy GD from fuseswap
	 * @param _value fuse to be sold
	 * @return uniswap coversion results uint256[2]
	 */
	function _buyGD(uint256 _value) internal returns (uint256[] memory) {
		//buy from uniwasp
		require(_value > 0, "buy value should be > 0");
		(uint256 maxFuse, uint256 fuseGDOut) = calcMaxFuseWithPriceImpact(_value);
		(uint256 maxFuseUSDC, uint256 usdcGDOut) = calcMaxFuseUSDCWithPriceImpact(
			_value
		);
		address[] memory path;
		if (maxFuse >= maxFuseUSDC) {
			path = new address[](2);
			path[1] = address(GD);
			path[0] = uniswap.WETH();
			return
				uniswap.swapExactETHForTokens{ value: maxFuse }(
					(fuseGDOut * 95) / 100,
					path,
					address(this),
					block.timestamp
				);
		} else {
			(uint256 usdcAmount, uint256 usedFuse) = _buyUSDC(maxFuseUSDC);
			path = new address[](2);
			path[1] = address(GD);
			path[0] = USDC;

			uint256[] memory result = uniswap.swapExactTokensForTokens(
				usdcAmount,
				(usdcGDOut * 95) / 100,
				path,
				address(this),
				block.timestamp
			);
			//buyGD should return how much fuse was used in [0] and how much G$ we got in [1]
			result[0] = usedFuse;
			return result;
		}
	}

	/**
	 * @dev internal method to buy USDC via fuse->fusd
	 * @param _fuseIn fuse to be sold
	 * @return usdcAmount and usedFuse how much usdc we got and how much fuse was used
	 */

	function _buyUSDC(uint256 _fuseIn)
		internal
		returns (uint256 usdcAmount, uint256 usedFuse)
	{
		//buy from uniwasp
		require(_fuseIn > 0, "buy value should be > 0");
		UniswapPair uniswapFUSEfUSDPair = UniswapPair(
			uniswapFactory.getPair(uniswap.WETH(), fUSD)
		); //fusd is pegged 1:1 to usdc
		(uint256 r_fuse, uint256 r_fusd, ) = uniswapFUSEfUSDPair.getReserves();

		(uint256 maxFuse, uint256 tokenOut) = calcMaxTokenWithPriceImpact(
			r_fuse,
			r_fusd,
			_fuseIn
		); //expect r_token to be in 18 decimals

		address[] memory path = new address[](2);
		path[1] = fUSD;
		path[0] = uniswap.WETH();
		uint256[] memory result = uniswap.swapExactETHForTokens{ value: maxFuse }(
			(tokenOut * 95) / 100,
			path,
			address(this),
			block.timestamp
		);

		pegSwap.swap(result[1], fUSD, USDC);
		usedFuse = result[0];
		usdcAmount = result[1] / 1e12; //convert fusd from 1e18 to usdc 1e6
	}

	function calcMaxFuseWithPriceImpact(uint256 _value)
		public
		view
		returns (uint256 fuseAmount, uint256 tokenOut)
	{
		(uint256 r_fuse, uint256 r_gd, ) = UniswapPair(
			uniswapFactory.getPair(uniswap.WETH(), address(GD))
		).getReserves();

		return calcMaxTokenWithPriceImpact(r_fuse, r_gd, _value);
	}

	function calcMaxFuseUSDCWithPriceImpact(uint256 _value)
		public
		view
		returns (uint256 maxFuse, uint256 gdOut)
	{
		UniswapPair uniswapFUSEfUSDPair = UniswapPair(
			uniswapFactory.getPair(uniswap.WETH(), fUSD)
		); //fusd is pegged 1:1 to usdc
		UniswapPair uniswapGDUSDCPair = UniswapPair(
			uniswapFactory.getPair(address(GD), USDC)
		);
		(uint256 rg_gd, uint256 rg_usdc, ) = uniswapGDUSDCPair.getReserves();
		(uint256 r_fuse, uint256 r_fusd, ) = uniswapFUSEfUSDPair.getReserves();
		//fusd is 1e18 so to keep in original 1e18 precision we first multiply by 1e18
		uint256 fusdPriceInFuse = r_fuse.mul(1e18).div(r_fusd);
		// console.log(
		// 	"rgd: %s rusdc:%s usdcPriceInFuse: %s",
		// 	rg_gd,
		// 	rg_usdc,
		// 	fusdPriceInFuse
		// );
		// console.log("rfuse: %s rusdc:%s", r_fuse, r_fusd);

		//how many fusd we can get for fuse
		//value and usdPriceInFuse are in 1e18, we mul by 1e18 to keep 18 decimals precision
		uint256 fuseValueInfUSD = _value.mul(1e18).div(fusdPriceInFuse);
		// console.log("fuse fusd value: %s", fuseValueInfUSD);

		(uint256 maxUSDC, uint256 tokenOut) = calcMaxTokenWithPriceImpact(
			rg_usdc * 1e12,
			rg_gd,
			fuseValueInfUSD
		); //expect r_token to be in 18 decimals
		// console.log("max USDC: %s", maxUSDC);
		gdOut = tokenOut;
		maxFuse = maxUSDC.mul(fusdPriceInFuse).div(1e18); //both are in 1e18 precision, div by 1e18 to keep precision
	}

	/**
	 * uniswap amountOut helper
	 */
	function getAmountOut(
		uint256 _amountIn,
		uint256 _reserveIn,
		uint256 _reserveOut
	) internal pure returns (uint256 amountOut) {
		uint256 amountInWithFee = _amountIn * 997;
		uint256 numerator = amountInWithFee * _reserveOut;
		uint256 denominator = _reserveIn * 1000 + amountInWithFee;
		amountOut = numerator / denominator;
	}

	/**
	 * @dev use binary search to find quantity that will result with price impact < maxPriceImpactRatio
	 */
	function calcMaxTokenWithPriceImpact(
		uint256 r_token,
		uint256 r_gd,
		uint256 _value
	) public view returns (uint256 maxToken, uint256 tokenOut) {
		maxToken = (r_token * maxSlippageRatio) / RATIO_BASE;
		maxToken = maxToken < _value ? maxToken : _value;
		tokenOut = getAmountOut(maxToken, r_token, r_gd);
		// uint256 start = 0;
		// uint256 end = _value.div(1e18); //save iterations by moving precision to whole Fuse quantity
		// // uint256 curPriceWei = uint256(1e18).mul(r_gd) / r_token; //uniswap quote  formula UniswapV2Library.sol
		// uint256 gdForQuantity = getAmountOut(1e18, r_token, r_gd);
		// uint256 priceForQuantityWei = rdiv(1e18, gdForQuantity.mul(1e16)).div(
		// 	1e9
		// );
		// uint256 maxPriceWei = priceForQuantityWei
		// .mul(RATIO_BASE.add(maxSlippageRatio))
		// .div(RATIO_BASE);
		// // console.log(
		// // 	"curPrice: %s, maxPrice %s",
		// // 	priceForQuantityWei,
		// // 	maxPriceWei
		// // );
		// fuseAmount = _value;
		// tokenOut;
		// //Iterate while start not meets end
		// while (start <= end) {
		// 	// Find the mid index
		// 	uint256 midQuantityWei = start.add(end).mul(1e18).div(2); //restore quantity precision
		// 	if (midQuantityWei == 0) break;
		// 	gdForQuantity = getAmountOut(midQuantityWei, r_token, r_gd);
		// 	priceForQuantityWei = rdiv(midQuantityWei, gdForQuantity.mul(1e16))
		// 	.div(1e9);
		// 	// console.log(
		// 	// 	"gdForQuantity: %s, priceForQuantity: %s, midQuantity: %s",
		// 	// 	gdForQuantity,
		// 	// 	priceForQuantityWei,
		// 	// 	midQuantityWei
		// 	// );
		// 	if (priceForQuantityWei <= maxPriceWei) {
		// 		start = midQuantityWei.div(1e18) + 1; //reduce precision to whole quantity div 1e18
		// 		fuseAmount = midQuantityWei;
		// 		tokenOut = gdForQuantity;
		// 	} else end = midQuantityWei.div(1e18) - 1; //reduce precision to whole quantity div 1e18
		// }
	}

	function undelegateWithCatch(address _validator, uint256 _amount)
		internal
		returns (bool)
	{
		try consensus.withdraw(_validator, _amount) {
			return true;
		} catch Error(
			string memory /*reason*/
		) {
			// This is executed in case
			// revert was called inside getData
			// and a reason string was provided.
			return false;
		} catch (
			bytes memory /*lowLevelData*/
		) {
			// This is executed in case revert() was used
			// or there was a failing assertion, division
			// by zero, etc. inside getData.
			return false;
		}
	}

	function balance() internal view returns (uint256) {
		return payable(address(this)).balance;
	}

	function setPaused(bool _paused) external onlyGuardian {
		paused = _paused;
	}

	function setGuardian(address _guardian) external onlyGuardian {
		guardian = _guardian;
	}

	function collectCommunityPool(address _to, uint256 amount)
		external
		onlyGuardian
	{
		communityPoolBalance -= amount;
		GD.transfer(_to, amount);
	}

	receive() external payable {}
}
