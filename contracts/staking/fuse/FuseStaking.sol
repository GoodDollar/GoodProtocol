// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";

import "../utils/StakingRewardsPerEpoch.sol";
import "./utils/GoodDollarSwaps.sol";
import "./utils/ValidatorsManagement.sol";
import "./IConsensus.sol";
import "./ISpendingRateOracle.sol";

contract FuseStaking is
	StakingRewardsPerEpoch,
	GoodDollarSwaps,
	ValidatorsManagement,
	AccessControl
{
	using SafeERC20 for IERC20;

	IUBIScheme public ubiScheme;

	uint256 public keeperRatio;
	uint256 public communityPoolRatio;
	uint256 public communityPoolBalance;

	uint256 public minGivebackRatio;
	uint256 public globalGivebackRatio;
	uint256 public pendingGivebackRatio;
	mapping(address => uint256) public giveBackRatioPerUser;

	ISpendingRateOracle public spendingRateOracle;
	uint256 public lastDayCollected; //ubi day from ubischeme
	mapping(address => mapping(address => uint256)) public allowance;

	event UBICollected(
		uint256 indexed currentDay,
		uint256 ubiAmount, //G$ sent to ubischeme
		uint256 communityPoolAmount, //G$ added to pool
		uint256 gdBoughtAmount, //actual G$ we got out of swapping stakingRewards + pendingFuseEarnings
		uint256 stakingRewardsAmount, //rewards earned since previous collection,
		uint256 pendingFuseEarnings, //new balance of fuse pending to be swapped for G$
		address keeper,
		uint256 keeperGDFee
	);
	event Transfer(address indexed from, address indexed to, uint256 value);
	event Approval(address indexed owner, address indexed spender, uint256 value);

	bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
	mapping(address => mapping(address => uint256)) public allowance;
	address internal _rewardsToken;

	constructor(address __rewardsToken)
		StakingRewardsPerEpoch()
	{
		_rewardsToken = __rewardsToken;
	}

	function stake(uint256 _giveBackRatio) public payable {
		stake(address(0), _giveBackRatio);
	}

	function stake(address _validator, uint256 _giveBackRatio)
		public
		payable
		nonReentrant
		whenNotPaused
		updateReward(msg.sender)
	{
		require(msg.value > 0, "stake must be > 0");
		_stake(msg.sender, _validator, msg.value, _giveBackRatio);
	}

	function _stake(address _from, uint256 _amount) internal override {
		pendingStakes += _amount;
		stakersInfo[_from].pendingStake += _amount;
		stakersInfo[_from].indexOfLastEpochStaked = lastEpochIndex;
		emit Staked(_from, _amount, lastEpochIndex);
	}

	function _stake(
		address _from,
		address _validator,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		_requireValidValidator(_validator);
		require(
			_giveBackRatio >= minGivebackRatio,
			"giveback should be higher or equal to minimum"
		);
		require(_stakeNextValidator(_amount, _validator), "stakeFailed");
		_updateGiveBackRatiosAndStake(_from, _amount, _giveBackRatio);
		_stake(_from, _amount);
		emit Staked(_from, _amount, lastEpochIndex);
	}

	function _updateGiveBackRatiosAndStake(
		address _from,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		_updateGivebackRatioForStakerAndPending(_from, _amount, _giveBackRatio);
		_stake(_from, _amount);
	}

	function _updateGivebackRatioForStakerAndPending(
		address _from,
		uint256 _amount,
		uint256 _giveBackRatio
	) internal {
		giveBackRatioPerUser[_from] = _weightedAverage(
			giveBackRatioPerUser[_from],
			stakersInfo[_from].balance,
			_giveBackRatio,
			_amount
		);
		pendingGivebackRatio = _weightedAverage(
			pendingGivebackRatio,
			pendingStakes,
			_giveBackRatio,
			_amount
		);
	}

	function _updateGlobalGivebackRatio() internal {
		globalGivebackRatio = _weightedAverage(
			globalGivebackRatio,
			totalSupply,
			pendingGivebackRatio,
			pendingStakes
		);
	}

	/**
	 * @dev Calculates the weighted average of two values based on their weights.
	 * @param valueA The amount for value A
	 * @param weightA The weight to use for value A
	 * @param valueB The amount for value B
	 * @param weightB The weight to use for value B
	 */
	function _weightedAverage(
		uint256 valueA,
		uint256 weightA,
		uint256 valueB,
		uint256 weightB
	) internal pure returns (uint256) {
		return (valueA * weightA + valueB * weightB) / (weightA + weightB);
	}

	function withdraw(uint256 amount) public nonReentrant {
		require(amount > 0, "cannotWithdraw0");
		_withdraw(msg.sender, msg.sender, amount);
	}

	function _withdraw(address _from, uint256 _amount) internal override {
		if (stakersInfo[_from].pendingStake > 0) {
			uint256 pendingToReduce = stakersInfo[_from].pendingStake >= _amount
				? _amount
				: stakersInfo[_from].pendingStake;
			pendingStakes -= pendingToReduce;
			stakersInfo[_from].pendingStake -= pendingToReduce;
		}
	}

	function _withdraw(
		address _from,
		address _to,
		uint256 _amount
	) internal {
		uint256 effectiveBalance = address(this).balance;
		require(
			_amount > 0 && _amount <= _balanceOf(_from),
			"invalid withdraw amount"
		);
		_gatherFuseFromValidators(_amount);
		effectiveBalance = address(this).balance - effectiveBalance; //use only undelegated funds

		// in case some funds were not withdrawn
		if (_amount > effectiveBalance) {
			_amount = effectiveBalance;
		}

		_withdraw(_from, _amount);

		if (_to != address(0)) {
			payable(_to).transfer(_amount);
			emit Withdrawn(_to, _amount, lastEpochIndex);
		}
	}

	function acquireCommunityPoolBalance(address _to)
		external
		onlyRole(GUARDIAN_ROLE)
	{
		require(goodDollar.transfer(_to, communityPoolBalance));
	}

	function _distributeToUBIAndCommunityPool(
		uint256 _ubiAmount,
		uint256 _communityPoolAmount
	) internal returns (uint256 _gdUBIAmount, uint256 _gdCommunityPoolAmount) {
		if (_ubiAmount == 0 || _communityPoolAmount == 0) {
			_gdUBIAmount = 0;
			_gdCommunityPoolAmount = 0;
		}
		uint256[] memory swapResult = _buyGD(_ubiAmount);
		require(
			goodDollar.transfer(address(ubiScheme), swapResult[1]),
			"ubiPartTransferFailed"
		);
		_gdUBIAmount = swapResult[1];
		swapResult = _buyGD(_communityPoolAmount);
		communityPoolBalance += swapResult[1];
		_gdCommunityPoolAmount = swapResult[1];
	}

	function _distributeGivebackAndQueryOracle(uint256 _amount) internal virtual {
		if (_amount == 0) return;
		address[] memory faucetAddresses = spendingRateOracle.getFaucets();
		for (uint256 i = 0; i < faucetAddresses.length; i++) {
			address faucetToken = spendingRateOracle.getFaucetTokenAddress(
				faucetAddresses[i]
			);
			uint256 targetBalance = spendingRateOracle.getFaucetTargetBalance(
				faucetAddresses[i]
			);
			uint256 balancesDifference;
			if (faucetToken == address(0)) {
				if (faucetToken.balance < targetBalance) {
					balancesDifference = targetBalance - faucetToken.balance;
					_amount -= balancesDifference;
					payable(faucetAddresses[i]).transfer(balancesDifference);
					spendingRateOracle.queryBalance(
						faucetAddresses[i],
						faucetAddresses[i].balance,
						address(0)
					);
				}
			} else {
				IERC20 faucetTokenInstance = IERC20(faucetToken);
				uint256 actualBalance = faucetTokenInstance.balanceOf(
					faucetAddresses[i]
				);
				if (actualBalance < targetBalance) {
					balancesDifference = targetBalance - actualBalance;
					_amount -= balancesDifference;
					uint256[] memory buyResult = _buyGD(balancesDifference);
					faucetTokenInstance.safeTransfer(faucetAddresses[i], buyResult[1]);
					spendingRateOracle.queryBalance(
						faucetAddresses[i],
						faucetTokenInstance.balanceOf(faucetAddresses[i]),
						faucetToken
					);
				}
			}
		}
	}

	function _checkIfCalledOnceInDayAndReturnDay() internal returns (uint256) {
		uint256 curDay = ubiScheme.currentDay();
		require(curDay != lastDayCollected, "can collect only once in a ubi cycle");
		lastDayCollected = curDay;
		return curDay;
	}

	function collectUBIInterest() external onlyRole(GUARDIAN_ROLE) {
		uint256 curDay = _checkIfCalledOnceInDayAndReturnDay();
		uint256 earnings = _balance();

		uint256 stakersPart = (earnings * (RATIO_BASE - globalGivebackRatio)) /
			RATIO_BASE;
		uint256 daoPart = earnings - stakersPart;
		uint256 keeperPart;
		uint256 communityPoolPart;

		if (daoPart > 0) {
			keeperPart =
				daoPart -
				(daoPart * (RATIO_BASE - keeperRatio)) /
				RATIO_BASE;
			daoPart -= keeperPart;
			communityPoolPart =
				daoPart -
				(daoPart * (RATIO_BASE - communityPoolRatio)) /
				RATIO_BASE;
			daoPart -= communityPoolPart;
		}

		_distributeGivebackAndQueryOracle(daoPart);
		(
			uint256 gdUBIAmount,
			uint256 gdCommunityPoolAmount
		) = _distributeToUBIAndCommunityPool(keeperPart, communityPoolPart);
		uint256[] memory buyResult = _buyGD(stakersPart);
		_notifyRewardAmount(buyResult[1]);
		_updateGlobalGivebackRatio();

		emit UBICollected(
			curDay,
			gdUBIAmount,
			gdCommunityPoolAmount,
			buyResult[1],
			earnings,
			buyResult[2],
			msg.sender,
			keeperPart
		);
	}

	function addValidator(address _validator) external onlyRole(GUARDIAN_ROLE) {
		_addValidator(_validator);
	}

	function removeValidator(address _validator)
		external
		onlyRole(GUARDIAN_ROLE)
	{
		_removeValidator(_validator);
	}

	function getReward() public nonReentrant updateReward(msg.sender) {
		uint256 reward = _getReward(msg.sender);
		IERC20(_rewardsToken).safeTransfer(msg.sender, reward);
	}

	function exit() external {
		withdraw(stakersInfo[msg.sender].balance);
		getReward();
	}

	function transfer(address _to, uint256 _amount) external returns (bool) {
		_transfer(msg.sender, _to, _amount);
	}

	function approve(address _spender, uint256 _amount) external returns (bool) {
		_approve(msg.sender, _spender, _amount);
		return true;
	}

	function _approve(
		address _owner,
		address _spender,
		uint256 _amount
	) internal {
		require(
			_owner != address(0),
			"FuseStakingV4: approve from the zero address"
		);
		require(
			_spender != address(0),
			"FuseStakingV4: approve to the zero address"
		);
		allowance[_owner][_spender] = _amount;
		emit Approval(_owner, _spender, _amount);
	}

	function transferFrom(
		address _from,
		address _to,
		uint256 _amount
	) public returns (bool) {
		address spender = _msgSender();
		_spendAllowance(_from, spender, _amount);
		_transfer(_from, _to, _amount);
		return true;
	}

	function _transfer(
		address _from,
		address _to,
		uint256 _amount
	) internal virtual {
		_withdraw(_from, address(0), _amount);
		uint256 givebackRatio = _getTransferGivebackRatio(_to, _from);
		_stake(_to, address(0), _amount, givebackRatio);
	}

	/**
	 * @dev determines the giveback ratio of a transferred stake
	 * @param _to the receiver
	 * @param _from the sender
	 * @return receiver average giveback ratio if he has one, otherwise sender giveback ratio
	 */
	function _getTransferGivebackRatio(address _to, address _from)
		internal
		view
		returns (uint256)
	{
		return
			giveBackRatioPerUser[_to] > 0
				? giveBackRatioPerUser[_to]
				: giveBackRatioPerUser[_from] > 0
				? giveBackRatioPerUser[_from]
				: minGivebackRatio;
	}

	function _spendAllowance(
		address _owner,
		address _spender,
		uint256 _amount
	) internal virtual {
		uint256 currentAllowance = allowance[_owner][_spender];
		if (currentAllowance != type(uint256).max) {
			require(currentAllowance >= _amount, "insufficient allowance");
			unchecked {
				_approve(_owner, _spender, currentAllowance - _amount);
			}
		}
	}
}
