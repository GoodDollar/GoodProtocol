// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;
import "../Interfaces.sol";
import "../utils/DSMath.sol";

/***
 * supports accounting for multiple staking contracts to calculate GDAO rewards
 */
abstract contract MultiBaseGovernanceShareField is DSMath {
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
		uint128 amount; // How many tokens the user has staked.
		uint128 rewardDebt; // Rewards that accounted already so should be substracted while calculating rewards of staker
		uint128 rewardEarn; // Reward earn and not minted
		uint128 rewardMinted; // rewards sent to the user
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
		_update(_contract, 0, block.number); //we need to accrue rewards before we change the rewards rate
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

		(uint256 _lastRewardBlock, uint256 _accAmountPerShare) = _calcUpdate(
			_contract,
			_blockStart,
			_blockEnd
		);

		accAmountPerShare[_contract] = _accAmountPerShare;
		lastRewardBlock[_contract] = _lastRewardBlock;
	}

	/**
	 * @dev helper to calculate global rewards accumulated per block so far
	 * @param _contract the contract to calcualte the rewards for
	 * @param _blockStart the block from which the contract is eligble for rewards
	 * @param _blockEnd the block from which the contract is no longer eligble for rewards
	 */
	function _calcUpdate(
		address _contract,
		uint256 _blockStart,
		uint256 _blockEnd
	)
		internal
		view
		returns (uint256 _lastRewardBlock, uint256 _accAmountPerShare)
	{
		_accAmountPerShare = accAmountPerShare[_contract];
		_lastRewardBlock = lastRewardBlock[_contract];
		_lastRewardBlock = _lastRewardBlock < _blockStart &&
			block.number >= _blockStart
			? _blockStart
			: _lastRewardBlock;
		uint256 curRewardBlock = block.number > _blockEnd
			? _blockEnd
			: block.number;
		if (curRewardBlock < _blockStart || _lastRewardBlock >= _blockEnd)
			return (_lastRewardBlock, _accAmountPerShare);

		uint256 multiplier = curRewardBlock - _lastRewardBlock; // Blocks passed since last reward block
		uint256 reward = multiplier * rewardsPerBlock[_contract]; // rewardsPerBlock is in GDAO which is in 18 decimals

		_accAmountPerShare += (reward * 1e27) / totalProductivity[_contract]; // totalProductivity in 18decimals  and reward in 18 decimals so rdiv result in 27decimals
		_lastRewardBlock = curRewardBlock;
	}

	/**
	 * @dev Audit user's rewards and calculate their earned rewards based on stake_amount * accAmountPerShare
	 */
	function _audit(
		address _contract,
		address _user,
		uint256 _updatedAmount
	) internal virtual {
		UserInfo storage userInfo = contractToUsers[_contract][_user];
		if (userInfo.amount > 0) {
			uint256 pending = (userInfo.amount * accAmountPerShare[_contract]) /
				1e27 -
				userInfo.rewardDebt; // Divide 1e27(because userinfo.amount in 18 decimals and accAmountPerShare is in 27decimals) since rewardDebt in 18 decimals so we can calculate how much reward earned in that cycle
			userInfo.rewardEarn = userInfo.rewardEarn + uint128(pending); // Add user's earned rewards to user's account so it can be minted later
			totalRewardsAccumulated[_contract] =
				totalRewardsAccumulated[_contract] +
				pending;
		}
		userInfo.amount = uint128(_updatedAmount);
		userInfo.rewardDebt = uint128(
			(_updatedAmount * accAmountPerShare[_contract]) / 1e27
		); // Divide to 1e27 to keep rewardDebt in 18 decimals since accAmountPerShare is in 27 decimals and amount is 18 decimals
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
		_update(_contract, _blockStart, _blockEnd);
		_audit(_contract, _user, contractToUsers[_contract][_user].amount + _value);

		totalProductivity[_contract] = totalProductivity[_contract] + _value;
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
		_update(_contract, _blockStart, _blockEnd);
		_audit(_contract, _user, contractToUsers[_contract][_user].amount - _value);

		totalProductivity[_contract] = totalProductivity[_contract] - _value;

		return true;
	}

	/**
	 * @dev Query user's pending reward with updated variables
	 * @param _contract the contract to calcualte the rewards for
	 * @param _blockStart the block from which the contract is eligble for rewards
	 * @param _blockEnd the block from which the contract is no longer eligble for rewards
	 * @param _user the user to calculate rewards for
	 * @return returns  amount of user's earned but not minted rewards
	 */
	function getUserPendingReward(
		address _contract,
		uint256 _blockStart,
		uint256 _blockEnd,
		address _user
	) public view returns (uint256) {
		UserInfo memory userInfo = contractToUsers[_contract][_user];
		uint256 pending = 0;
		if (totalProductivity[_contract] != 0) {
			(, uint256 _accAmountPerShare) = _calcUpdate(
				_contract,
				_blockStart,
				_blockEnd
			);

			pending = userInfo.rewardEarn;
			pending +=
				(userInfo.amount * _accAmountPerShare) /
				1e27 -
				userInfo.rewardDebt; // Divide 1e27(because userinfo.amount in 18 decimals and accAmountPerShare is in 27decimals) since rewardDebt in 18 decimals so we can calculate how much reward earned in that cycle
		}

		return pending;
	}

	/**
    @dev Calculate earned rewards of the user and update their reward info
	* @param _contract address of the contract for accounting
    * @param _user address of the user that will be accounted
	* @param _blockStart the block from which the contract is eligble for rewards
	* @param _blockEnd the block from which the contract is no longer eligble for rewards
    * @return returns minted amount
    */

	function _issueEarnedRewards(
		address _contract,
		address _user,
		uint256 _blockStart,
		uint256 _blockEnd
	) internal returns (uint256) {
		_update(_contract, _blockStart, _blockEnd);
		_audit(_contract, _user, contractToUsers[_contract][_user].amount);
		uint128 amount = contractToUsers[_contract][_user].rewardEarn;
		contractToUsers[_contract][_user].rewardMinted += amount;
		contractToUsers[_contract][_user].rewardEarn = 0;
		rewardsMintedSoFar[_contract] = rewardsMintedSoFar[_contract] + amount;
		return amount;
	}

	/**
	 * @return Returns how much productivity a user has and total productivity.
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

	// for upgrades
	uint256[50] private _gap;
}
