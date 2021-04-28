// SPDX-License-Identifier: MIT
pragma solidity >=0.6.6;
import "../Interfaces.sol";
import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/utils/math/Math.sol";
import "../utils/DAOContract.sol";
import "../utils/DSMath.sol";
import "hardhat/console.sol";
interface FundManager {
	function rewardsForStakingContract(address _staking)
		external
		view
		returns (
			uint256,
			uint256,
			uint256,
			bool
		);

	function transferInterest(address _staking) external;

	function mintReward(address _token, address _user) external;
}

contract BaseShareField is DSMath, DAOContract {
	using SafeMath for uint256;

	uint256 totalProductivity;
	uint256 accAmountPerShare;

	uint256 public mintedShare;
	uint256 public mintCumulation;
	uint64 public maxMultiplierThreshold;
	address public shareToken;

	uint256 public lastRewardBlock;

	struct UserInfo {
		uint256 amount; // How many tokens the user has provided.
		uint256 rewardDebt; // Reward debt.
		uint256 rewardEarn; // Reward earn and not minted
		uint64 lastRewardTime; // Last time that user got rewards
		uint64 multiplierResetTime; // Reset time of multiplier
	}

	mapping(address => UserInfo) public users;

	modifier onlyFundManager {
		require(
			msg.sender == nameService.getAddress("FUND_MANAGER"),
			"Only FundManager can call this method"
		);
		_;
	}

	function _setShareToken(address _shareToken) internal {
		shareToken = _shareToken;
	}

	/**
	 * @dev Update reward variables of the given pool to be up-to-date.
	 * Calculates passed blocks and adding to the reward pool
	 */
	function _update() internal virtual {
		if (totalProductivity == 0) {
			lastRewardBlock = block.number;
			return;
		}
		FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
		(uint256 rewardsPerBlock, uint256 blockStart, uint256 blockEnd, ) =
			fm.rewardsForStakingContract(address(this));
		if (block.number >= blockStart && lastRewardBlock < blockStart)
			lastRewardBlock = blockStart;
		if (block.number >= blockStart && blockEnd >= block.number) {
			uint256 multiplier = block.number - lastRewardBlock;
			uint256 reward = multiplier * (rewardsPerBlock * 1e16); // rewardsPerBlock is in G$ which is only 2 decimals, we turn it into 18 decimals

			accAmountPerShare =
				accAmountPerShare +
				((reward * 1e18) / totalProductivity); // multiply by 1e18 so keep accAmountPerShare in 18 decimals
		}
		lastRewardBlock = block.number;
	}

	/**
	 * @dev Audit user's rewards and calculate their earned rewards based on
	 * For the first month rewards calculated with 0.5x
	 * multiplier therefore they just gets half of the rewards which they earned in the first month
	 * after first month they get full amount of rewards for the part that they earned after one month
	 */
	function _audit(address user) internal virtual {
		UserInfo storage userInfo = users[user];
		if (userInfo.amount > 0) {
			(
				uint256 blocksToPay,
				uint256 firstMonthBlocksToPay,
				uint256 fullBlocksToPay
			) = _auditCalcs(userInfo);

			if (blocksToPay != 0) {
				uint256 pending =
					(userInfo.amount * accAmountPerShare) /
						1e18 -
						userInfo.rewardDebt; // Divide 1e18 to reduce 18 Decimals since rewardDebt in 18 decimals
				uint256 rewardPerBlock =
					rdiv(pending , blocksToPay * 1e18); // bring both variable to 18 decimals so they would be in same decimals
				pending =
					rmul(
						((firstMonthBlocksToPay * 5 * 1e17) + // multiply with 1e17 since normally there is divide 10
							fullBlocksToPay *
							1e18),
						rewardPerBlock
					); // pending should be in 18 decimals
				userInfo.rewardEarn = userInfo.rewardEarn + pending;
				mintCumulation = mintCumulation + pending;
			}
		} else {
			userInfo.multiplierResetTime = uint64(block.number); // Should set user's multiplierResetTime when they stake for the first time
		}
	}

	/**
	 * @dev Helper function to make calculations in audit and getUserPendingReward methods
	 */
	function _auditCalcs(UserInfo memory _userInfo)
		internal
		view
		returns (
			uint256,
			uint256,
			uint256
		)
	{
		uint256 blocksPaid =
			_userInfo.lastRewardTime - _userInfo.multiplierResetTime; // lastRewardTime is always >= multiplierResetTime
		uint256 blocksPassedFirstMonth =
			Math.min(
				maxMultiplierThreshold,
				block.number - _userInfo.multiplierResetTime
			); // blocks which is after first month
		uint256 blocksToPay = block.number - _userInfo.lastRewardTime; // blocks since last payment
		uint256 firstMonthBlocksToPay =
			blocksPaid >= maxMultiplierThreshold
				? 0
				: blocksPassedFirstMonth - blocksPaid; // block which is in the first month which pays with 0.5x multiplier
		uint256 fullBlocksToPay = blocksToPay - firstMonthBlocksToPay; // blocks to pay in full amount which means with 1x multiplier
		return (blocksToPay, firstMonthBlocksToPay, fullBlocksToPay);
	}

	/**
	 * @dev This function increase user's productivity and updates the global productivity.
	 * This function increase user's productivity and updates the global productivity.
	 * the users' actual share percentage will calculated by:
	 * Formula:     user_productivity / global_productivity
	 */
	function _increaseProductivity(address user, uint256 value)
		internal
		virtual
		returns (bool)
	{
		require(value > 0, "PRODUCTIVITY_VALUE_MUST_BE_GREATER_THAN_ZERO");

		UserInfo storage userInfo = users[user];
		_update();
		_audit(user);

		totalProductivity = totalProductivity + value;
		userInfo.lastRewardTime = uint64(block.number);
		userInfo.amount = userInfo.amount + value;
		userInfo.rewardDebt = (userInfo.amount * accAmountPerShare) / 1e18;
		return true;
	}

	/**
	 * @dev This function will decreases user's productivity by value, and updates the global productivity
	 * it will record which block this is happenning and accumulates the area of (productivity * time)
	 */

	function _decreaseProductivity(address user, uint256 value)
		internal
		virtual
		returns (bool)
	{
		UserInfo storage userInfo = users[user];
		require(
			value > 0 && userInfo.amount >= value,
			"INSUFFICIENT_PRODUCTIVITY"
		);

		_update();
		_audit(user);
		userInfo.lastRewardTime = uint64(block.number);
		userInfo.multiplierResetTime = uint64(block.number);
		userInfo.amount = userInfo.amount - value;
		userInfo.rewardDebt = (userInfo.amount * accAmountPerShare) / 1e18;
		totalProductivity = totalProductivity - value;

		return true;
	}

	/**
	 * @dev Query user's pending reward with updated variables
	 * @return returns  amount of user's earned but not minted rewards
	 */
	function getUserPendingReward(address user) public view returns (uint256) {
		UserInfo memory userInfo = users[user];
		uint256 _accAmountPerShare = accAmountPerShare;
		// uint256 lpSupply = totalProductivity;
		FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
		uint256 pending = 0;
		(uint256 rewardsPerBlock, uint256 blockStart, uint256 blockEnd, ) =
			fm.rewardsForStakingContract(address(this));
		if (
			totalProductivity != 0 &&
			block.number >= blockStart &&
			blockEnd >= block.number
		) {
			uint256 multiplier = block.number - lastRewardBlock;
			uint256 reward = multiplier * (rewardsPerBlock * 1e16); // turn it to 18 decimals
			(
				uint256 blocksToPay,
				uint256 firstMonthBlocksToPay,
				uint256 fullBlocksToPay
			) = _auditCalcs(userInfo);

			_accAmountPerShare =
				_accAmountPerShare +
				((reward * 1e18) / totalProductivity);
			UserInfo memory tempUserInfo = userInfo; // to prevent stack too deep error any other recommendation?
			if (blocksToPay != 0) {
				pending =
					(tempUserInfo.amount * _accAmountPerShare) /
					1e18 -
					tempUserInfo.rewardDebt; // Divide 1e18 to reduce 18 Decimals since rewardDebt in 18 decimals
				uint256 rewardPerBlock =
					rdiv(pending , blocksToPay * 1e18); // bring both variable to 18 decimals so they would be in same decimals
				pending =
					rmul(
						((firstMonthBlocksToPay * 5 * 1e17) + // multiply with 1e17 since normally there is divide 10
							fullBlocksToPay *
							1e18),
						rewardPerBlock
					); // pending should be in 18 decimals
			}
		}
		return userInfo.rewardEarn + pending / 1e16; // Reward earn in 18decimals so need to divide 1e16 to bring down gd decimals which is 2
	}

	/** 
    @dev When the fundmanager calls this function it will updates the user records 
    * get the user rewards which they earned but not minted and mark it as minted 
    * @param user address of the user that will be accounted
    * @return returns amount to mint as reward to the user
    */

	function userAccounting(address user)
		public
		onlyFundManager
		returns (uint256)
	{
		_update();
		_audit(user);
		UserInfo storage userInfo = users[user];
		uint256 amount = userInfo.rewardEarn;
		userInfo.rewardEarn = 0;
		userInfo.lastRewardTime = uint64(block.number);
		userInfo.multiplierResetTime = uint64(block.number);
		mintedShare = mintedShare + amount;
		amount = amount / 1e16; // change decimal of mint amount to GD decimals
		return amount;
	}

	/**
	 * @return Returns how many productivity a user has and global has.
	 */

	function getProductivity(address user)
		public
		view
		virtual
		returns (uint256, uint256)
	{
		return (users[user].amount, totalProductivity);
	}

	/**
	 * @return Returns the current gross product rate.
	 */
	function interestsPerBlock() public view virtual returns (uint256) {
		return accAmountPerShare;
	}
}
