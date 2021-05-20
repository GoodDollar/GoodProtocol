// SPDX-License-Identifier: MIT
pragma solidity >=0.6.6;
import "../Interfaces.sol";
import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/utils/math/Math.sol";

import "../utils/DSMath.sol";

/***
 * supports accounting for multiple staking contracts
 */
abstract contract MultiBaseGovernanceShareField {
	using SafeMath for uint256;
	// Total Amount of stakes
	mapping(address => uint256) totalProductivity;
	// Reward amount of the each share
	mapping(address => uint256) accAmountPerShare;
	// Amount of the rewards which minted so far
	mapping(address => uint256) public rewardsMintedSoFar;
	// Amount of the rewards with pending and minted ones together
	mapping(address => uint256) public totalRewardsAccumulated;

	// Block number of last reward calculation made
	mapping(address => uint256) public lastRewardBlock;
	// Rewards amount that will be provided each block
	mapping(address => uint256) public rewardsPerBlock;

	struct UserInfo {
		uint256 amount; // How many tokens the user has staked.
		uint256 rewardDebt; // Rewards that accounted already so should be substracted while calculating rewards of staker
		uint256 rewardEarn; // Reward earn and not minted
	}

	mapping(address => mapping(address => UserInfo)) public contractToUsers;

	function getChainBlocksPerMonth() public virtual returns (uint256);

	/**
	 * @dev Calculate rewards per block from monthly amount of rewards and set it
	 * @param _monthlyAmount total rewards which will distribute monthly
	 */
	function _setMonthlyRewards(address _contract, uint256 _monthlyAmount)
		internal
	{
		rewardsPerBlock[_contract] = _monthlyAmount / getChainBlocksPerMonth();
	}

	/**
	 * @dev Update reward variables of the given pool to be up-to-date.
	 * Make reward calculations according to passed blocks and updates rewards by
	 * multiplying passed blocks since last calculation with rewards per block value
	 * and add it to accumalated amount per share by dividing total productivity
	 */
	function _update(
		address _contract,
		uint256 _blockStart,
		uint256 _blockEnd
	) internal virtual {
		if (totalProductivity[_contract] == 0) {
			lastRewardBlock[_contract] = block.number;
			return;
		}

		uint256 _lastRewardBlock = lastRewardBlock[_contract];

		_lastRewardBlock = _lastRewardBlock < _blockStart
			? _blockStart
			: _lastRewardBlock;

		uint256 curRewardBlock =
			block.number > _blockEnd ? _blockEnd : block.number;

		uint256 multiplier = curRewardBlock - _lastRewardBlock; // Blocks passed since last reward block
		uint256 reward = multiplier * rewardsPerBlock[_contract]; // rewardsPerBlock is in GDAO which is in 18 decimals

		accAmountPerShare[_contract] =
			accAmountPerShare[_contract] +
			rdiv(reward, totalProductivity[_contract] * 1e16); // totalProductivity in 2decimals since it is GD so we multiply it by 1e16 to bring 18 decimals and rdiv result in 27decimals
		lastRewardBlock[_contract] = curRewardBlock;
	}

	/**
	 * @dev Audit user's rewards and calculate their earned rewards based on stake_amount * accAmountPerShare
	 */
	function _audit(address _contract, address _user) internal virtual {
		UserInfo storage userInfo = contractToUsers[_contract][_user];
		if (userInfo.amount > 0) {
			uint256 pending =
				(userInfo.amount * accAmountPerShare[_contract]) /
					1e11 -
					userInfo.rewardDebt; // Divide 1e11(because userinfo.amount in 2 decimals and accAmountPerShare is in 27decimals) since rewardDebt in 18 decimals so we can calculate how much reward earned in that cycle
			userInfo.rewardEarn = userInfo.rewardEarn + pending; // Add user's earned rewards to user's account so it can be minted later
			totalRewardsAccumulated[_contract] =
				totalRewardsAccumulated[_contract] +
				pending;
		}
	}

	/**
	 * @dev This function increase user's productivity and updates the global productivity.
	 * This function increase user's productivity and updates the global productivity.
	 * the users' actual share percentage will calculated by:
	 * Formula:     user_productivity / global_productivity
	 */
	function _increaseProductivity(
		address _contract,
		address _user,
		uint256 _value,
		uint256 _blockStart,
		uint256 _blockEnd
	) internal virtual returns (bool) {
		UserInfo storage userInfo = contractToUsers[_contract][_user];
		_update(_contract, _blockStart, _blockEnd);
		_audit(_contract, _user);

		totalProductivity[_contract] = totalProductivity[_contract] + _value;
		userInfo.amount = userInfo.amount + _value;
		userInfo.rewardDebt =
			(userInfo.amount * accAmountPerShare[_contract]) /
			1e11; // Divide to 1e11 to keep rewardDebt in 18 decimals since accAmountPerShare is in 27 decimals and amount is GD which is 2 decimals
		return true;
	}

	/**
	 * @dev This function will decreases user's productivity by value, and updates the global productivity
	 * it will record which block this is happenning and accumulates the area of (productivity * time)
	 */

	function _decreaseProductivity(
		address _contract,
		address _user,
		uint256 _value,
		uint256 _blockStart,
		uint256 _blockEnd
	) internal virtual returns (bool) {
		UserInfo storage userInfo = contractToUsers[_contract][_user];
		require(
			_value > 0 && userInfo.amount >= _value,
			"INSUFFICIENT_PRODUCTIVITY"
		);

		_update(_contract, _blockStart, _blockEnd);
		_audit(_contract, _user);

		userInfo.amount = userInfo.amount - _value;
		userInfo.rewardDebt =
			(userInfo.amount * accAmountPerShare[_contract]) /
			1e11; // Divide to 1e11 to keep rewardDebt in 18 decimals since accAmountPerShare is in 27 decimals and amount is GD which is 2 decimals
		totalProductivity[_contract] = totalProductivity[_contract] - _value;

		return true;
	}

	/**
	 * @dev Query user's pending reward with updated variables
	 * @return returns  amount of user's earned but not minted rewards
	 */
	function getUserPendingReward(address _contract, address _user)
		public
		view
		returns (uint256)
	{
		UserInfo memory userInfo = contractToUsers[_contract][_user];
		uint256 _accAmountPerShare = accAmountPerShare[_contract];

		uint256 pending = 0;

		if (totalProductivity[_contract] != 0) {
			uint256 multiplier = block.number - lastRewardBlock[_contract];
			uint256 reward = multiplier * rewardsPerBlock[_contract]; // rewardsPerBlock is in GDAO which is in 18 decimals

			_accAmountPerShare =
				_accAmountPerShare +
				rdiv(reward, totalProductivity[_contract] * 1e16); // totalProductivity in 2decimals since it is GD so we multiply it by 1e16 to bring 18 decimals and rdiv result in 27decimals

			pending =
				(userInfo.amount * _accAmountPerShare) /
				1e11 -
				userInfo.rewardDebt; // Divide 1e11(because userinfo.amount in 2 decimals and accAmountPerShare is in 27decimals) since rewardDebt in 18 decimals so we can calculate how much reward earned in that cycle
		}
		return userInfo.rewardEarn + pending;
	}

	/** 
    @dev Calculate earned rewards of the user and update their reward info
	* @param _contract address of the contract for accounting
    * @param _user address of the user that will be accounted
    * @return returns minted amount
    */

	function _issueEarnedRewards(
		address _contract,
		address _user,
		uint256 _blockStart,
		uint256 _blockEnd
	) internal returns (uint256) {
		_update(_contract, _blockStart, _blockEnd);
		_audit(_contract, _user);
		UserInfo storage userInfo = contractToUsers[_contract][_user];
		uint256 amount = userInfo.rewardEarn;
		userInfo.rewardEarn = 0;
		rewardsMintedSoFar[_contract] = rewardsMintedSoFar[_contract] + amount;
		return amount;
	}

	/**
	 * @return Returns how many productivity a user has and global has.
	 */

	function getProductivity(address _contract, address _user)
		public
		view
		virtual
		returns (uint256, uint256)
	{
		return (
			contractToUsers[_contract][_user].amount,
			totalProductivity[_contract]
		);
	}

	/**
	 * @return Returns the current gross product rate.
	 */
	function totalRewardsPerShare(address _contract)
		public
		view
		virtual
		returns (uint256)
	{
		return accAmountPerShare[_contract];
	}

	function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
		z = x.mul(10**27).add(y / 2) / y;
	}

	uint256[50] private _gap;
}
