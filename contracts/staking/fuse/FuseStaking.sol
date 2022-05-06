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
		require(_stakeNextValidator(_amount, _validator), "stakeFailed");
		_stake(_from, _amount);
		emit Staked(_from, _amount, lastEpochIndex);
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
		_stake(_to, address(0), _amount, 0);
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
