// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "../../utils/DAOUpgradeableContract.sol";
import "../../utils/DSMath.sol";
import "../../Interfaces.sol";
import "./IConsensus.sol";
import "./PegSwap.sol";
import "./IUBIScheme.sol";
import "./ISpendingRateOracle.sol";

contract FuseStaking is DAOUpgradeableContract, Pausable, AccessControl, DSMath {

	struct GlobalStakingVariables {
		uint256 rewardPerToken;
		uint256 rewardRate;
		uint256 totalFinalizedSupply;
	}

	bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

	mapping(address => uint256) public pendingStakes;
	mapping(address => uint256) public stakersGivebackRatios;

	address[] public validators;

	IConsensus public consensus;

	Uniswap public uniswap;
	IGoodDollar public goodDollar;
	IUBIScheme public ubiScheme;
	UniswapFactory public uniswapFactory;
	UniswapPair public uniswapPair;

	uint256 public lastDayCollected; //ubi day from ubiScheme

	uint256 public immutable ratioBase;
	uint256 public totalPendingStakes;

	uint256 public maxSlippageRatio; //actually its max price impact ratio
	uint256 public keeperFeeRatio;
	uint256 public communityPoolRatio; //out of G$ bought how much should goto pool
	uint256 public minGivebackRatio;
	uint256 public globalGivebackRatio;

	uint256 public communityPoolBalance;
	uint256 public pendingFuseEarnings; //earnings not  used because of slippage

	address public USDC;
	address public fUSD;

	PegSwap public pegSwap;

	mapping(address => mapping(address => uint256)) public allowance;
	mapping(address => uint256) public userRewardPerTokenPaid;

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

	function initialize(address _owner) public initializer {
		consensus = IConsensus(
			address(0x3014ca10b91cb3D0AD85fEf7A3Cb95BCAc9c0f79)
		);
		validators.push(address(0xcb876A393F05a6677a8a029f1C6D7603B416C0A6));
		_setupRole(DEFAULT_ADMIN_ROLE, _owner);
		_setupRole(GUARDIAN_ROLE, _owner);
	}

	function setContracts(address _gd, address _ubischeme) public onlyRole(DEFAULT_ADMIN_ROLE, msg.sender) {
		if (_gd != address(0)) {
			goodDollar = IGoodDollar(_gd);
		}
		if (_ubischeme != address(0)) {
			ubiScheme = IUBIScheme(_ubischeme);
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
			return totalFinalizedSupply;
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
		uint256 toCollect = toWithdraw;

		require(
			toWithdraw > 0 && toWithdraw <= pendingStakes[_from],
			"invalid withdraw amount"
		);

		_gatherFuseFromValidators(_value);

		effectiveBalance = _balance() - effectiveBalance; //use only undelegated funds

		// in case some funds where not withdrawn
		if (toWithdraw > effectiveBalance) {
			toWithdraw = effectiveBalance;
		}

		_getReward();

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

	function addValidator(address _v) public onlyRole(DEFAULT_ADMIN_ROLE, msg.sender) {
		validators.push(_v);
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

	function removeValidator(address _validator) external onlyRole(DEFAULT_ADMIN_ROLE, msg.sender) {
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

	function _getLastRewardPerTokenPerUser(address _account) internal view returns(uint256) {
		if (collectUBIInterestCallTimes.length > 0) {
			uint256 rewardPerTokenPerUser = 0;
			for (uint256 i = 1; i < collectUBIInterestCallTimes.length; i++) {
				rewardPerTokenPerUser +=
					_rewardPerToken(
						globalStakingVariablesHistory[i - 1].rewardPerToken,
						collectUBIInterestCallTimes[i] - collectUBIInterestCallTimeIdxToUserStakeTime[i][_account],
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
		return pendingStakes[account] * (_getLastRewardPerTokenPerUser(account) - userRewardPerTokenPaid[account]) / PRECISION;
	}

	function _getReward(address _to) internal {
		uint256 reward = earned(_to);
		if (reward > 0) {
				userRewardPerTokenPaid[_to] = _getLastRewardPerTokenPerUser(_to);
				payable(_to).transfer(reward);
		}
	}

	function getReward() external nonReentrant {
			_getReward();
	}

	function _distributeGivebackAndQueryOracles(uint256 _amount) internal {
		if (_amount == 0) return;
		// todo oracle query and distrubution
	}

	function _rewardPerToken(
		uint256 _lastRewardPerToken,
		uint256 _duration
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

		uint256 fuseAmountForUBI = (earnings * (ratioBase - globalGivebackRatio)) / ratioBase;
		uint256 givebackAmount = earnings > 0 ? earnings - fuseAmountForUBI : 0;

		_distributeGivebackAndQueryOracles(givebackAmount);

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

	function collectUBIInterest() public nonReentrant whenNotPaused onlyRole(GUARDIAN_ROLE, msg.sender) {
		_collectUBIInterest(true); // check if contract earned something - true
	}

	/**
	 * @dev internal method to buy goodDollar from fuseswap
	 * @param _value fuse to be sold
	 * @return uniswap coversion results uint256[2]
	 */
	function _buyGD(uint256 _value) internal returns (uint256[] memory) {
		//buy from uniwasp
		require(_value > 0, "buy value should be > 0");
		(uint256 maxFuse, uint256 fuseGDOut) = calcMaxFuseWithPriceImpact(
			_value
		);
		(
			uint256 maxFuseUSDC,
			uint256 usdcGDOut
		) = calcMaxFuseUSDCWithPriceImpact(_value);
		address[] memory path;
		if (maxFuse >= maxFuseUSDC) {
			path = new address[](2);
			path[1] = address(goodDollar);
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
			path[1] = address(goodDollar);
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
		uint256[] memory result = uniswap.swapExactETHForTokens{
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
		(uint256 r_fuse, uint256 r_gd, ) = uniswapPair.getReserves();

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
	 * uniswap amountOut helper
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
		maxToken = (r_token * maxSlippageRatio) / ratioBase;
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

	function togglePause() external onlyRole(DEFAULT_ADMIN_ROLE, msg.sender) {
		if (paused()) {
			_unpause();
		} else {
			_pause();
		}
	}

	receive() external payable {}
}