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
	uint256 public totalSupply;

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
	mapping(address => uint256) public rewards;

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

	// uint256[2] public updateRewardTimeInterval;
	// uint256[] public rewardPerTokenStoredAt;
	//
	// function _queryTimeOfUpdateReward(uint256 _newTime) internal {
	// 	updateRewardTimeInterval[0] = updateRewardTimeInterval[1];
	// 	updateRewardTimeInterval[1] = _newTime;
	// }
	//
	//
	// function getReward() public nonReentrant {
	// 		uint256 reward = rewards[msg.sender];
	// 		if (reward > 0) {
	// 				rewards[msg.sender] = 0;
	// 				payable(msg.sender).transfer(reward);
	// 				emit RewardPaid(msg.sender, reward);
	// 		}
	// }

	// function rewardPerToken() public view returns (uint256) {
	// 		if (totalSupply == 0) {
	// 				return _getLastRewardPerTokenStored();
	// 		}
	// 		return
	// 				_getLastRewardPerTokenStored() + ((updateRewardTimeInterval[1] - updateRewardTimeInterval[0]) * rewardRate * 1e18 / totalSupply);
	// }

	// function _getLastRewardPerTokenStored() internal view returns(uint256) {
	// 	return rewardPerTokenStoredAt[rewardPerTokenStoredAt.length > 0 ? rewardPerTokenStoredAt.length - 1 : 0];
	// }
	// function earned(address account) public view returns (uint256) {
	// 		return _pendingStakes[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 + rewards[account];
	// }

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

	uint256[] public collectUBIInterestCallTimes;
	mapping(uint256 => mapping(address => uint256)) public collectUBIInterestCallTimeIdxToUserStakeTime;

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
		uint256 effectiveBalance = balance(); //use only undelegated funds
		uint256 toWithdraw = _value == 0 ? pendingStakes[_from] : _value;
		uint256 toCollect = toWithdraw;

		require(
			toWithdraw > 0 && toWithdraw <= pendingStakes[_from],
			"invalid withdraw amount"
		);

		_gatherFuseFromValidators(_value);

		effectiveBalance = balance() - effectiveBalance; //use only undelegated funds

		// in case some funds where not withdrawn
		if (toWithdraw > effectiveBalance) {
			toWithdraw = effectiveBalance;
		}

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
			uint256 prevBalance = balance();
			_safeUndelegate(_validator, delegated);

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

	function _checkIfCalledOnceInDayAndReturnDay() internal returns(uint256) {
		uint256 curDay = ubiScheme.currentDay();
		require(
			curDay != lastDayCollected,
			"can collect only once in a ubi cycle"
		);
		lastDayCollected = curDay;
		return curDay;
	}

	uint256[] public rewardPerTokenAt;
	uint256 public constant PRECISION = 1e18;
	uint256 public rewardRate;
	ISpendingRateOracle public spendingRateOracle;

	function _getLastRewardPerToken() internal view returns(uint256) {
		return rewardPerTokenAt[rewardPerTokenAt.length > 0 ? rewardPerTokenAt.length - 1 : 0];
	}

	function earned(address account) public view returns (uint256) {
			return _pendingStakes[account] * (_getLastRewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 + rewards[account];
	}

	function _updateReward() internal {
		rewards[msg.sender] = earned(msg.sender);
	}

	function getReward() public nonReentrant {
			uint256 reward = rewards[msg.sender];
			if (reward > 0) {
					rewards[msg.sender] = 0;
					payable(msg.sender).transfer(reward);
					emit RewardPaid(msg.sender, reward);
			}
	}

	function collectUBIInterest() public nonReentrant whenNotPaused onlyRole(GUARDIAN_ROLE, msg.sender) {
		uint256 curDay = _checkIfCalledOnceInDayAndReturnDay();

		totalSupply += totalPendingStakes;

		uint256 contractBalance = balance();
		require(contractBalance > 0, "no earnings to collect");
		uint256 earnings = contractBalance - totalPendingStakes;

		uint256 fuseAmountForUBI = (earnings * (ratioBase - globalGivebackRatio)) / ratioBase;
		uint256 stakeBackAmount = earnings - fuseAmountForUBI;

		uint256 lastCollectUBIInterestCallTime = collectUBIInterestCallTimes.length > 0
			? collectUBIInterestCallTimes[collectUBIInterestCallTimes.length - 1]
			: 0;

		uint256 lastRewardPerToken = rewardPerTokenAt.length > 0 ? rewardPerTokenAt[rewardPerTokenAt.length - 1] : 0;

		collectUBIInterestCallTimes.push(block.timestamp);
		uint256 latestCollectUBIInterestTimeDuration = block.timestamp - lastCollectUBIInterestCallTime;
		rewardRate = fuseAmountForUBI / latestCollectUBIInterestTimeDuration;
		rewardPerTokenAt.push(
			lastRewardPerToken + latestCollectUBIInterestTimeDuration * rewardRate * PRECISION / totalSupply
		);

		// rewards[msg.sender] = earned(account);
		// userRewardPerTokenPaid[msg.sender] = rewardPerTokenStored;
		// uint256 reward = rewards[msg.sender];
		//
		// rewards[msg.sender] = 0;
		// payable(msg.sender).transfer(reward);
		// userRewardPerTokenPaid[] += reward;

		// uint256 ubiAndPendingStakes = fuseUBI + totalPendingStakes;
		// uint256[] memory fuseswapResult = _buyGD(ubiAndPendingStakes); //buy goodDollar with X% of earnings

		// pendingFuseEarnings = ubiAndPendingStakes - fuseswapResult[0];
		// _stakeNextValidator(stakeBack, address(0)); //stake back the rest of the earnings

		// send to the faucets

		// uint256 gdBought = fuseswapResult[fuseswapResult.length - 1];
		//
		// uint256 keeperFee = gdBought * keeperFeeRatio / ratioBase;
		// if (keeperFee > 0) goodDollar.transfer(msg.sender, keeperFee);
		//
		// uint256 communityPoolContribution = (gdBought - keeperFee) * communityPoolRatio / ratioBase;
		//
		// uint256 ubiAfterFeeAndPool = gdBought - communityPoolContribution - keeperFee;
		//
		// goodDollar.transfer(address(ubiScheme), ubiAfterFeeAndPool); //transfer to ubiScheme
		// communityPoolBalance += communityPoolContribution;
		//
		// emit UBICollected(
		// 	curDay,
		// 	ubiAfterFeeAndPool,
		// 	communityPoolContribution,
		// 	gdBought,
		// 	earnings,
		// 	pendingFuseEarnings,
		// 	msg.sender,
		// 	keeperFee
		// );
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

	function balance() internal view returns (uint256) {
		return payable(address(this)).balance;
	}

	function togglePause() external onlyRole(DEFAULT_ADMIN_ROLE, msg.sender) {
		if (paused()) {
			_unpause();
		} else {
			_pause();
		}
	}

	modifier updateReward(address account) {
		rewardPerTokenStored = rewardPerToken();
		lastUpdateTime = lastTimeRewardApplicable();
		if (account != address(0)) {
		    rewards[account] = earned(account);
		    userRewardPerTokenPaid[account] = rewardPerTokenStored;
		}
	}

	receive() external payable {}
}
