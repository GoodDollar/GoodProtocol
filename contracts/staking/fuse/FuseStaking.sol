// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "../../utils/DAOUpgradeableContract.sol";
import "../../utils/DSMath.sol";
import "../../Interfaces.sol";
import "./IConsensus.sol";
import "./PegSwap.sol";
import "./ISpendingRateOracle.sol";

contract FuseStaking is DAOUpgradeableContract, Pausable, AccessControl, DSMath, ReentrancyGuard {
	using SafeERC20 for IERC20;

	struct GlobalStakingVariables {
		uint256 rewardPerToken;
		uint256 rewardRate;
		uint256 totalFinalizedSupply;
	}

	bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
	uint256 public constant RATIO_BASE = 10000;

	address[] public validators;

	IConsensus public consensus;

	Uniswap public uniswapV2Router;
	IGoodDollar public goodDollar;
	IUBIScheme public ubiScheme;
	UniswapFactory public uniswapFactory;
	UniswapPair public uniswapGoodDollarFusePair;

	uint256 public lastDayCollected; //ubi day from ubiScheme

	uint256 public totalPendingStakes;

	uint256 public maxSlippageRatio; //actually its max price impact ratio

	uint256 public keeperAndCommunityPoolRatio;
	uint256 public communityPoolBalance;

	uint256 public minGivebackRatio;
	uint256 public globalGivebackRatio;

	// uint256 public pendingFuseEarnings; //earnings not  used because of slippage

	address public USDC;
	address public fUSD;

	PegSwap public pegSwap;

	mapping(address => mapping(address => uint256)) public allowance;

	mapping(address => uint256) public userRewardPerTokenPaid;
	mapping(address => uint256) public pendingStakes;
	mapping(address => uint256) public stakersGivebackRatios;

	// struct StakeInfo {
	// 	uint256 u
	// }

	uint256[] public collectUBIInterestCallTimes;

	mapping(uint256 => mapping(address => uint256)) public collectUBIInterestCallTimeIdxToUserStakeTime;

	GlobalStakingVariables[] internal globalStakingVariablesHistory;

	uint256 public constant PRECISION = 1e18;
	ISpendingRateOracle public spendingRateOracle;

	uint8 public decimals = 18;
	string public symbol = "GF";
	string public name = "gFuse";

	event Transfer(address indexed from, address indexed to, uint256 value);
	event Approval(address indexed owner, address indexed spender, uint256 value);

	event UBICollected(
		uint256 indexed currentDay,
		uint256 ubi, //G$ sent to ubiScheme
		uint256 communityPool, //G$ added to pool
		uint256 gdBought, //actual G$ we got out of swapping stakingRewards + pendingFuseEarnings
		uint256 stakingRewards, //rewards earned since previous collection,
		uint256 pendingFuseEarnings, //new balance of fuse pending to be swapped for G$
		address keeper,
		uint256 keeperGDFee
	);

	function initialize(
		address _owner,
		address _spendingRateOracle,
		address _uniswapV2Router,
		address _goodDollar,
		address _ubiScheme,
		address _uniswapGoodDollarFusePair,
		uint256 _maxSlippageRatio, //actually its max price impact ratio
		uint256 _keeperAndCommunityPoolFeeRatio,
		uint256 _minGivebackRatio,
		address _USDC,
		address _fUSD
	) public initializer {
		consensus = IConsensus(
			address(0x3014ca10b91cb3D0AD85fEf7A3Cb95BCAc9c0f79)
		);
		validators.push(address(0xcb876A393F05a6677a8a029f1C6D7603B416C0A6));

		_setupRole(DEFAULT_ADMIN_ROLE, _owner);
		_setupRole(GUARDIAN_ROLE, _owner);

		spendingRateOracle = ISpendingRateOracle(_spendingRateOracle);
		uniswapV2Router = Uniswap(_uniswapV2Router);
		goodDollar = IGoodDollar(_goodDollar);
		ubiScheme = IUBIScheme(_ubiScheme);
		uniswapGoodDollarFusePair = UniswapPair(_uniswapGoodDollarFusePair);

		maxSlippageRatio = _maxSlippageRatio;
		keeperAndCommunityPoolRatio = _keeperAndCommunityPoolFeeRatio;
		minGivebackRatio = _minGivebackRatio;
		USDC = _USDC;
		fUSD = _fUSD;

		_collectUBIInterest(false); // initialize history of staking variables
	}

	function setContracts(address _gd, address _ubischeme) public onlyRole(GUARDIAN_ROLE) {
		if (_gd != address(0)) {
			goodDollar = IGoodDollar(_gd);
		}
		if (_ubischeme != address(0)) {
			ubiScheme = IUBIScheme(_ubischeme);
		}
	}

	function addValidator(address _v) public onlyRole(GUARDIAN_ROLE) {
		validators.push(_v);
	}

	function togglePause() external onlyRole(GUARDIAN_ROLE) {
		if (paused()) {
			_unpause();
		} else {
			_pause();
		}
	}

	function removeValidator(address _validator) external onlyRole(GUARDIAN_ROLE) {
		uint256 delegated = consensus.delegatedAmount(
			address(this),
			_validator
		);
		if (delegated > 0) {
			uint256 prevBalance = _balance();
			_safeUndelegate(_validator, delegated);

			// wasnt withdrawn because validator needs to be taken of active validators
			if (_balance() == prevBalance) {
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

	function stake(uint _giveBackRatio) public payable returns (bool) {
		return stake(address(0), _giveBackRatio);
	}

	function stake(address _validator, uint256 _giveBackRatio) public payable returns (bool) {
		require(msg.value > 0, "stake must be > 0");
		return _stake(msg.sender, _validator, msg.value, _giveBackRatio);
	}

	function _requireValidValidator(address _validator) internal {
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
	}

	function _stake(address _to, address _validator, uint256 _amount, uint256 _giveBackRatio) internal returns (bool) {
		require(validators.length > 0, "no approved validators");
		_requireValidValidator(_validator);

		require(_giveBackRatio >= minGivebackRatio, "giveback should be higher or equal to minimum");
		bool staked = _stakeNextValidator(_amount, _validator);
		_updateStakerBalanceAndGiveback(_to, _amount, _giveBackRatio);

		return staked;
	}

	function _updateStakerBalanceAndGiveback(address _to, uint256 _amount, uint256 _giveBackRatio) internal {
		stakersGivebackRatios[_to] = weightedAverage(stakersGivebackRatios[_to], pendingStakes[_to], _giveBackRatio, _amount);
		globalGivebackRatio = weightedAverage(globalGivebackRatio, totalPendingStakes, _giveBackRatio, _amount);

		pendingStakes[_to] += _amount;
		totalPendingStakes += _amount;

		uint256 callTimeIdx = collectUBIInterestCallTimes.length > 0 ? collectUBIInterestCallTimes.length - 1 : 0;
		collectUBIInterestCallTimeIdxToUserStakeTime[callTimeIdx][_to] = block.timestamp;
	}

	/**
   * @dev Calculates the weighted average of two values based on their weights.
   * @param valueA The amount for value A
   * @param weightA The weight to use for value A
   * @param valueB The amount for value B
   * @param weightB The weight to use for value B
   */
  function weightedAverage(
      uint256 valueA,
      uint256 weightA,
      uint256 valueB,
      uint256 weightB
  ) internal pure returns (uint256) {
			return (valueA * weightA + valueB * weightB) / (weightA + weightB);
  }

	function totalSupply() public view returns (uint256) {
			return _getLastTotalFinalizedSupply();
	}

	function balanceOf(address _owner) public view returns (uint256) {
		return pendingStakes[_owner];
	}

	function transfer(address to, uint256 amount) external returns (bool) {
		_transfer(msg.sender, to, amount);
	}

	function approve(address spender, uint256 amount) external returns (bool) {
		_approve(msg.sender, spender, amount);
		return true;
  }

	function _approve(address owner, address spender, uint256 amount) internal {
		require(owner != address(0), "FuseStakingV4: approve from the zero address");
		require(spender != address(0), "FuseStakingV4: approve to the zero address");
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
	}

	function transferFrom(
    address from,
    address to,
    uint256 amount
  ) public returns (bool) {
    address spender = _msgSender();
    _spendAllowance(from, spender, amount);
    _transfer(from, to, amount);
    return true;
  }

	function _transfer(
    address from,
    address to,
    uint256 amount
  ) internal virtual {
		_withdraw(from, address(this), amount);
		uint256 givebackRatio = getTransferGivebackRatio(to, from);
		_stake(to, address(0), amount, givebackRatio);
	}

	/**
	 * @dev determines the giveback ratio of a transferred stake
	 * @param to the receiver
	 * @param from the sender
	 * @return receiver average giveback ratio if he has one, otherwise sender giveback ratio
	 */
	function getTransferGivebackRatio(address to, address from) internal view returns (uint256){
		return stakersGivebackRatios[to] > 0 ?
					stakersGivebackRatios[to] :
					stakersGivebackRatios[from] > 0 ?
						stakersGivebackRatios[from] :
						minGivebackRatio;
	}

	function _spendAllowance(
    address owner,
    address spender,
    uint256 amount
  ) internal virtual {
    uint256 currentAllowance = allowance[owner][spender];
    if (currentAllowance != type(uint256).max) {
      require(currentAllowance >= amount, "FuseStakingV4: insufficient allowance");
      unchecked {
        _approve(owner, spender, currentAllowance - amount);
      }
    }
  }

	function _gatherFuseFromValidators(uint256 _value) internal {
		uint256 toCollect = _value;
		uint256 perValidator = _value / validators.length;
		for (uint256 i = 0; i < validators.length; i++) {
			uint256 cur = consensus.delegatedAmount(
				address(this),
				validators[i]
			);
			if (cur == 0) continue;
			if (cur <= perValidator) {
				_safeUndelegate(validators[i], cur);
				toCollect = toCollect - cur;
			} else {
				_safeUndelegate(validators[i], perValidator);
				toCollect = toCollect - perValidator;
			}
			if (toCollect == 0) break;
		}
	}

	function _withdraw(address _from, address _to, uint256 _value) internal returns (uint256) {
		uint256 effectiveBalance = _balance(); //use only undelegated funds
		uint256 toWithdraw = _value == 0 ? pendingStakes[_from] : _value;

		require(
			toWithdraw > 0 && toWithdraw <= pendingStakes[_from],
			"invalid withdraw amount"
		);

		_gatherFuseFromValidators(toWithdraw);

		effectiveBalance = _balance() - effectiveBalance; //use only undelegated funds

		// in case some funds where not withdrawn
		if (toWithdraw > effectiveBalance) {
			toWithdraw = effectiveBalance;
		}

		_getReward(_from);

		pendingStakes[_from] = pendingStakes[_from] - toWithdraw;
		totalPendingStakes -= toWithdraw;

		if (toWithdraw > 0 && _to != address(this)) {
			payable(_to).transfer(toWithdraw);
		}
		return toWithdraw;
	}

	function _stakeNextValidator(uint256 _value, address _validator)
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
			uint256 cur = consensus.delegatedAmount(
				address(this),
				validators[i]
			);

			if (cur < perValidator) {
				uint256 toDelegate = perValidator - cur;
				toDelegate = toDelegate < left ? toDelegate : left;
				consensus.delegate{ value: toDelegate }(validators[i]);
				left = left - toDelegate;
			}
		}

		return true;
	}

	function totalDelegated() public view returns (uint256) {
		uint256 total = 0;
		for (uint256 i = 0; i < validators.length; i++) {
			uint256 cur = consensus.delegatedAmount(
				address(this),
				validators[i]
			);
			total += cur;
		}
		return total;
	}

	function _checkIfCalledOnceInDayAndReturnDay() internal returns(uint256) {
		uint256 curDay = ubiScheme.currentDay();
		require(
			curDay != lastDayCollected,
			"can collect only once in a ubi cycle"
		);
		lastDayCollected = curDay;
		return curDay;
	}

	function _getLastRewardPerToken() internal view returns(uint256) {
		return globalStakingVariablesHistory.length > 0 ? globalStakingVariablesHistory[globalStakingVariablesHistory.length - 1].rewardPerToken : 0;
	}

	function _getLastRewardRate() internal view returns(uint256) {
		return globalStakingVariablesHistory.length > 0 ? globalStakingVariablesHistory[globalStakingVariablesHistory.length - 1].rewardRate : 0;
	}

	function _getLastTotalFinalizedSupply() internal view returns(uint256) {
		return globalStakingVariablesHistory.length > 0 ? globalStakingVariablesHistory[globalStakingVariablesHistory.length - 1].totalFinalizedSupply : 0;
	}

	function _getRewardPerTokenPerUser(address _account) internal view returns(uint256) {
		if (collectUBIInterestCallTimes.length > 1) {
			uint256 rewardPerTokenPerUser = 0;
			for (uint256 i = 1; i < collectUBIInterestCallTimes.length; i++) {
				if (collectUBIInterestCallTimeIdxToUserStakeTime[i][_account] == 0) continue;
				rewardPerTokenPerUser +=
					_rewardPerToken(
						globalStakingVariablesHistory[i].rewardPerToken,
						collectUBIInterestCallTimes[i] - collectUBIInterestCallTimeIdxToUserStakeTime[i - 1][_account],
						globalStakingVariablesHistory[i].rewardRate,
						globalStakingVariablesHistory[i].totalFinalizedSupply
					);
			}
			return rewardPerTokenPerUser;
		} else {
			return 0;
		}
	}

	function earned(address account) public view returns (uint256) {
		return pendingStakes[account] * (_getRewardPerTokenPerUser(account) - userRewardPerTokenPaid[account]) / PRECISION;
	}

	function _getReward(address _to) internal {
		uint256 reward = earned(_to);
		if (reward > 0) {
				userRewardPerTokenPaid[_to] = _getRewardPerTokenPerUser(_to);
				payable(_to).transfer(reward);
		}
	}

	function getReward() external nonReentrant {
			_getReward(msg.sender);
	}

	function _distributeGivebackAndQueryOracle(uint256 _amount) internal {
		if (_amount == 0) return;
		address[] memory faucetAddresses = spendingRateOracle.getFaucets();
		for (uint256 i = 0; i < faucetAddresses.length; i++) {
			if (faucetAddresses[i] == address(ubiScheme) || faucetAddresses[i] == address(this)) {
				continue;
			}
			address faucetToken = spendingRateOracle.getFaucetTokenAddress(faucetAddresses[i]);
			uint256 targetBalance = spendingRateOracle.getFaucetTargetBalance(faucetAddresses[i]);
			uint256 balancesDifference;
			if (faucetToken == address(0)) {
				if (faucetToken.balance < targetBalance) {
					balancesDifference = targetBalance - faucetToken.balance;
					if (_amount < balancesDifference) break;
					_amount -= balancesDifference;
					payable(faucetAddresses[i]).transfer(balancesDifference);
				}
			} else {
				uint256 actualBalance = IERC20(faucetToken).balanceOf(faucetAddresses[i]);
				if (actualBalance < targetBalance) {
					balancesDifference = targetBalance - actualBalance;
					if (_amount < balancesDifference) break;
					_amount -= balancesDifference;
					// todo buying GD
					IERC20(faucetToken).safeTransfer(faucetAddresses[i], balancesDifference);
				}
			}
		}
	}

	function _distributeToUBIAndCommunityPoolAndQueryOracle(uint256 _ubiAmount, uint256 _communityPoolAmount) internal {
		if (_ubiAmount == 0 || _communityPoolAmount == 0) return;
		communityPoolBalance += _communityPoolAmount;
		spendingRateOracle.queryBalance(
			address(this),
			communityPoolBalance,
			address(0)
		);

		address ubiSchemeAddress = address(ubiScheme);
		require(goodDollar.transfer(ubiSchemeAddress, _ubiAmount));
		spendingRateOracle.queryBalance(
			ubiSchemeAddress,
			goodDollar.balanceOf(ubiSchemeAddress),
			address(goodDollar)
		);
	}

	function _rewardPerToken(
		uint256 _lastRewardPerToken,
		uint256 _duration,
		uint256 _rewardRate,
		uint256 _totalSupply
	)
		internal
		view
		returns(uint256)
	{
		return _lastRewardPerToken + _duration * _rewardRate * PRECISION / _totalSupply;
	}

	function _collectUBIInterest(bool _isEarningsCheckEnabled) internal {
		uint256 curDay = _checkIfCalledOnceInDayAndReturnDay();

		uint256 contractBalance;
		uint256 earnings;
		if (_isEarningsCheckEnabled) {
			contractBalance = _balance();
			require(contractBalance > 0, "no earnings to collect");
			earnings = contractBalance - totalPendingStakes;
		}

		uint256 fuseAmountForUBI = (earnings * (RATIO_BASE - globalGivebackRatio)) / RATIO_BASE;

		uint256 givebackAmount = earnings > 0 ? earnings - fuseAmountForUBI : 0;
		uint256 keeperAmount = fuseAmountForUBI > 0 ? fuseAmountForUBI - (fuseAmountForUBI * (RATIO_BASE - keeperAndCommunityPoolRatio)) / RATIO_BASE : 0;
		uint256 communityPoolAmount = fuseAmountForUBI > 0 ? fuseAmountForUBI - (fuseAmountForUBI * keeperAndCommunityPoolRatio) / RATIO_BASE : 0;

		_distributeGivebackAndQueryOracle(givebackAmount);
		_distributeToUBIAndCommunityPoolAndQueryOracle(keeperAmount, communityPoolAmount);

		uint256 lastCollectUBIInterestCallTime = collectUBIInterestCallTimes.length > 0
			? collectUBIInterestCallTimes[collectUBIInterestCallTimes.length - 1]
			: block.timestamp;
		collectUBIInterestCallTimes.push(block.timestamp);

		uint256 latestCollectUBIInterestTimeDuration = block.timestamp - lastCollectUBIInterestCallTime;

		globalStakingVariablesHistory.push(GlobalStakingVariables({
			rewardPerToken: _rewardPerToken(
				_getLastRewardPerToken(),
				latestCollectUBIInterestTimeDuration,
				_getLastRewardRate(),
				_getLastTotalFinalizedSupply()
			),
			rewardRate: latestCollectUBIInterestTimeDuration > 0 ? fuseAmountForUBI / latestCollectUBIInterestTimeDuration : 0,
			totalFinalizedSupply: totalPendingStakes
		}));
	}

	function collectUBIInterest() external whenNotPaused nonReentrant onlyRole(GUARDIAN_ROLE) {
		_collectUBIInterest(true); // check if contract earned something - true
	}

	/**
	 * @dev internal method to buy goodDollar from fuseswap
	 * @param _value fuse to be sold
	 * @return uniswapV2Router coversion results uint256[2]
	 */
	function _buyGD(uint256 _value) internal returns (uint256[] memory) {
		//buy from uniwasp
		require(_value > 0, "buy value should be > 0");
		(uint256 maxFuse, uint256 fuseGDOut) = calcMaxFuseWithPriceImpact(_value);
		(
			uint256 maxFuseUSDC,
			uint256 usdcGDOut
		) = calcMaxFuseUSDCWithPriceImpact(_value);
		address[] memory path;
		if (maxFuse >= maxFuseUSDC) {
			path = new address[](2);
			path[1] = address(goodDollar);
			path[0] = uniswapV2Router.WETH();
			return
				uniswapV2Router.swapExactETHForTokens{ value: maxFuse }(
					(fuseGDOut * 95) / 100,
					path,
					address(this),
					block.timestamp
				);
		} else {
			(uint256 usdcAmount, uint256 usedFuse) = _buyUSDC(maxFuseUSDC);
			path = new address[](2);
			path[1] = address(goodDollar);
			path[0] = USDC;

			uint256[] memory result = uniswapV2Router.swapExactTokensForTokens(
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
			uniswapFactory.getPair(uniswapV2Router.WETH(), fUSD)
		); //fusd is pegged 1:1 to usdc
		(uint256 r_fuse, uint256 r_fusd, ) = uniswapFUSEfUSDPair.getReserves();

		(uint256 maxFuse, uint256 tokenOut) = calcMaxTokenWithPriceImpact(
			r_fuse,
			r_fusd,
			_fuseIn
		); //expect r_token to be in 18 decimals

		address[] memory path = new address[](2);
		path[1] = fUSD;
		path[0] = uniswapV2Router.WETH();
		uint256[] memory result = uniswapV2Router.swapExactETHForTokens{
			value: maxFuse
		}((tokenOut * 95) / 100, path, address(this), block.timestamp);

		pegSwap.swap(result[1], fUSD, USDC);
		usedFuse = result[0];
		usdcAmount = result[1] / 1e12; //convert fusd from 1e18 to usdc 1e6
	}

	function calcMaxFuseWithPriceImpact(uint256 _value)
		public
		view
		returns (uint256 fuseAmount, uint256 tokenOut)
	{
		(uint256 r_fuse, uint256 r_gd, ) = uniswapGoodDollarFusePair.getReserves();

		return calcMaxTokenWithPriceImpact(r_fuse, r_gd, _value);
	}

	function calcMaxFuseUSDCWithPriceImpact(uint256 _value)
		public
		view
		returns (uint256 maxFuse, uint256 gdOut)
	{
		UniswapPair uniswapFUSEfUSDPair = UniswapPair(
			uniswapFactory.getPair(uniswapV2Router.WETH(), fUSD)
		); //fusd is pegged 1:1 to usdc
		UniswapPair uniswapGDUSDCPair = UniswapPair(
			uniswapFactory.getPair(address(goodDollar), USDC)
		);
		(uint256 rg_gd, uint256 rg_usdc, ) = uniswapGDUSDCPair.getReserves();
		(uint256 r_fuse, uint256 r_fusd, ) = uniswapFUSEfUSDPair.getReserves();
		uint256 fusdPriceInFuse = r_fuse * 1e18 / r_fusd; //fusd is 1e18 so to keep in original 1e18 precision we first multiply by 1e18
		// console.log(
		// 	"rgd: %s rusdc:%s usdcPriceInFuse: %s",
		// 	rg_gd,
		// 	rg_usdc,
		// 	fusdPriceInFuse
		// );
		// console.log("rfuse: %s rusdc:%s", r_fuse, r_fusd);

		//how many fusd we can get for fuse
		uint256 fuseValueInfUSD = _value * 1e18 / fusdPriceInFuse; //value and usdPriceInFuse are in 1e18, we mul by 1e18 to keep 18 decimals precision
		// console.log("fuse fusd value: %s", fuseValueInfUSD);

		(uint256 maxUSDC, uint256 tokenOut) = calcMaxTokenWithPriceImpact(
			rg_usdc * 1e12,
			rg_gd,
			fuseValueInfUSD
		); //expect r_token to be in 18 decimals
		// console.log("max USDC: %s", maxUSDC);
		gdOut = tokenOut;
		maxFuse = maxUSDC * fusdPriceInFuse / 1e18; //both are in 1e18 precision, div by 1e18 to keep precision
	}

	/**
	 * uniswapV2Router amountOut helper
	 */
	function _getAmountOut(
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
		tokenOut = _getAmountOut(maxToken, r_token, r_gd);
	}

	function _safeUndelegate(address _validator, uint256 _amount)
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

	function _balance() internal view returns (uint256) {
		return payable(address(this)).balance;
	}

	receive() external payable {}
}
