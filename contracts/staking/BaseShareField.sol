// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;
import "../Interfaces.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract BaseShareField {
	// total staked for shares calculation
	uint256 public totalProductivity;
	// total staked that earns rewards (some stakers can donate their rewards)
	uint256 public totalEffectiveStakes;
	// accumulated rewards per share in 27 decimals precision
	uint256 public accAmountPerShare;
	// rewards claimed by users
	uint256 public mintedRewards;
	// rewards accumulated for distribution
	uint256 public accumulatedRewards;
	// number of blocks before reaching the max rewards multiplier (starting at 0.5 reaching 1 after maxMultiplierThreshold)
	uint64 public maxMultiplierThreshold;
	// block of last rewards accumulation
	uint256 public lastRewardBlock;
	// Staking contracts accepts Tokens with max 18 decimals so this variable holds decimal difference between 18 and Token's decimal in order to make calculations
	uint8 public tokenDecimalDifference;

	//status of user rewards. everything is in 18 decimals
	struct UserInfo {
		uint256 amount; // How many tokens the user has provided.
		uint256 effectiveStakes; // stakes not including stakes that donate their rewards
		uint256 rewardDebt; // Reward debt.
		uint256 rewardEarn; // Reward earn and not minted
		uint256 rewardMinted; //Rewards minted to user so far
		uint64 lastRewardTime; // Last time that user got rewards
		uint64 multiplierResetTime; // Reset time of multiplier
	}
	mapping(address => UserInfo) public users;

	/**
	 * @dev Helper function to check if caller is fund manager
	 */
	function _canMintRewards() internal view virtual {}

	/**
	 * @dev Update reward variables of the given pool to be up-to-date.
	 * Calculates passed blocks and adding to the reward pool
	 * @param rewardsPerBlock how much rewards does this contract earns per block
	 * @param blockStart block from which contract starts earning rewards
	 * @param blockEnd block from which contract stops earning rewards
	 */
	function _update(
		uint256 rewardsPerBlock,
		uint256 blockStart,
		uint256 blockEnd
	) internal virtual {
		if (totalEffectiveStakes == 0) {
			lastRewardBlock = block.number;
			return;
		}
		if (block.number >= blockStart && lastRewardBlock < blockStart) {
			lastRewardBlock = blockStart;
		}

		uint256 _lastRewardBlock = lastRewardBlock < blockStart &&
			block.number >= blockStart
			? blockStart
			: lastRewardBlock;
		uint256 curRewardBlock = block.number > blockEnd ? blockEnd : block.number;
		if (curRewardBlock < blockStart || _lastRewardBlock >= blockEnd) return;

		uint256 multiplier = curRewardBlock - _lastRewardBlock; // Blocks passed since last reward block
		uint256 reward = multiplier * (rewardsPerBlock * 1e16); // rewardsPerBlock is in G$ which is only 2 decimals, we turn it into 18 decimals by multiplying 1e16

		accAmountPerShare =
			accAmountPerShare +
			(reward * 1e27) /
			(totalEffectiveStakes * (10**tokenDecimalDifference)); // Increase totalEffectiveStakes decimals if it is less than 18 decimals then accAmountPerShare in 27 decimals

		lastRewardBlock = curRewardBlock;
	}

	/**
	 * @dev Audit user's rewards and calculate their earned rewards
	 * For the first month rewards calculated with 0.5x
	 * multiplier therefore they just gets half of the rewards which they earned in the first month
	 * after first month they get full amount of rewards for the part that they earned after one month
	 * @param user the user to audit
	 * @param updatedAmount the new stake of the user after deposit/withdraw
	 * @param donationPer percentage user is donating from his rewards. (currently just 0 or 100 in SimpleStaking)
	 */
	function _audit(
		address user,
		uint256 updatedAmount,
		uint256 donationPer
	) internal virtual {
		UserInfo storage userInfo = users[user];
		uint256 _amount = userInfo.amount;
		uint256 userEffectiveStake = userInfo.effectiveStakes;
		if (userEffectiveStake > 0) {
			(
				uint256 blocksToPay,
				uint256 firstMonthBlocksToPay,
				uint256 fullBlocksToPay
			) = _auditCalcs(userInfo);

			if (blocksToPay != 0) {
				uint256 pending = (userEffectiveStake *
					(10**tokenDecimalDifference) *
					accAmountPerShare) /
					1e27 -
					userInfo.rewardDebt; // Turn userInfo.amount to 18 decimals by multiplying tokenDecimalDifference if it's not and multiply with accAmountPerShare which is 27 decimals then divide it 1e27 bring it down to 18 decimals
				uint256 rewardPerBlock = (pending * 1e27) / (blocksToPay * 1e18); // bring both variable to 18 decimals and multiply pending by 1e27 so when we divide them to each other result would be in 1e27
				pending =
					((((firstMonthBlocksToPay * 1e2 * 5) / 10) + fullBlocksToPay * 1e2) * // multiply first month by 0.5x (5/10) since rewards in first month with multiplier 0.5 and multiply it with 1e2 to get it 2decimals so we could get more precision
						rewardPerBlock) / // Multiply fullBlocksToPay with 1e2 to bring it to 2 decimals // rewardPerBlock is in 27decimals
					1e11; // Pending in 18 decimals so we divide 1e11 to bring it down to 18 decimals
				userInfo.rewardEarn = userInfo.rewardEarn + pending; // Add user's earned rewards to user's account so it can be minted later
				accumulatedRewards = accumulatedRewards + pending;
			}
		} else {
			userInfo.multiplierResetTime = uint64(block.number); // Should set user's multiplierResetTime when they stake for the first time
		}

		//if withdrawing rewards/stake we reset multiplier, only in case of increasinig productivity we dont reset multiplier
		if (updatedAmount <= _amount) {
			userInfo.multiplierResetTime = uint64(block.number);
			if (_amount > 0) {
				uint256 withdrawFromEffectiveStake = ((_amount - updatedAmount) *
					userInfo.effectiveStakes) / _amount;
				userInfo.effectiveStakes -= withdrawFromEffectiveStake;
				totalEffectiveStakes -= withdrawFromEffectiveStake;
			}
		} else if (donationPer == 0) {
			userInfo.effectiveStakes += (updatedAmount - _amount);
			totalEffectiveStakes += (updatedAmount - _amount);
		}
		userInfo.lastRewardTime = uint64(block.number);
		userInfo.amount = updatedAmount;
		userInfo.rewardDebt =
			(userInfo.effectiveStakes *
				(10**tokenDecimalDifference) *
				accAmountPerShare) /
			1e27; // Divide to 1e27 to keep rewardDebt in 18 decimals since accAmountPerShare is 27 decimals
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
		uint256 blocksPaid = _userInfo.lastRewardTime -
			_userInfo.multiplierResetTime; // lastRewardTime is always >= multiplierResetTime
		uint256 blocksPassedFirstMonth = Math.min(
			maxMultiplierThreshold,
			block.number - _userInfo.multiplierResetTime
		); // blocks which is after first month
		uint256 blocksToPay = block.number - _userInfo.lastRewardTime; // blocks passed since last payment
		uint256 firstMonthBlocksToPay = blocksPaid >= maxMultiplierThreshold
			? 0
			: blocksPassedFirstMonth - blocksPaid; // block which is in the first month so pays with 0.5x multiplier
		uint256 fullBlocksToPay = blocksToPay - firstMonthBlocksToPay; // blocks to pay in full amount which means with 1x multiplier
		return (blocksToPay, firstMonthBlocksToPay, fullBlocksToPay);
	}

	/**
	 * @dev This function increase user's productivity and updates the global productivity.
	 * This function increase user's productivity and updates the global productivity.
	 * the users' actual share percentage will calculated by:
	 * Formula:     user_productivity / global_productivity
	 * @param user the user to update
	 * @param value the increase in user stake
	 * @param rewardsPerBlock how much rewards does this contract earns per block
	 * @param blockStart block from which contract starts earning rewards
	 * @param blockEnd block from which contract stops earning rewards
	 * @param donationPer percentage user is donating from his rewards. (currently just 0 or 100 in SimpleStaking)
	 */
	function _increaseProductivity(
		address user,
		uint256 value,
		uint256 rewardsPerBlock,
		uint256 blockStart,
		uint256 blockEnd,
		uint256 donationPer
	) internal virtual returns (bool) {
		_update(rewardsPerBlock, blockStart, blockEnd);
		_audit(user, users[user].amount + value, donationPer);

		totalProductivity = totalProductivity + value;
		return true;
	}

	/**
	 * @dev This function will decreases user's productivity by value, and updates the global productivity
	 * it will record which block this is happenning and accumulates the area of (productivity * time)
	 * @param user the user to update
	 * @param value the increase in user stake
	 * @param rewardsPerBlock how much rewards does this contract earns per block
	 * @param blockStart block from which contract starts earning rewards
	 * @param blockEnd block from which contract stops earning rewards
	 */

	function _decreaseProductivity(
		address user,
		uint256 value,
		uint256 rewardsPerBlock,
		uint256 blockStart,
		uint256 blockEnd
	) internal virtual returns (bool) {
		_update(rewardsPerBlock, blockStart, blockEnd);
		_audit(user, users[user].amount - value, 1); // donationPer variable should be something different than zero so called with 1
		totalProductivity = totalProductivity - value;

		return true;
	}

	/**
	 * @dev Query user's pending reward with updated variables
	 * @param user the user to update
	 * @param rewardsPerBlock how much rewards does this contract earns per block
	 * @param blockStart block from which contract starts earning rewards
	 * @param blockEnd block from which contract stops earning rewards
	 * @return returns  amount of user's earned but not minted rewards
	 */
	function getUserPendingReward(
		address user,
		uint256 rewardsPerBlock,
		uint256 blockStart,
		uint256 blockEnd
	) public view returns (uint256) {
		UserInfo memory userInfo = users[user];
		uint256 _accAmountPerShare = accAmountPerShare;

		uint256 pending = 0;
		if (
			totalEffectiveStakes != 0 &&
			block.number >= blockStart &&
			blockEnd >= block.number
		) {
			uint256 multiplier = block.number - lastRewardBlock;
			uint256 reward = multiplier * (rewardsPerBlock * 1e16); // turn it to 18 decimals since rewardsPerBlock in 2 decimals
			(
				uint256 blocksToPay,
				uint256 firstMonthBlocksToPay,
				uint256 fullBlocksToPay
			) = _auditCalcs(userInfo);

			_accAmountPerShare =
				_accAmountPerShare +
				(reward * 1e27) /
				(totalEffectiveStakes * 10**tokenDecimalDifference); // Increase totalEffectiveStakes decimals if it is less than 18 decimals then accAmountPerShare in 27 decimals
			UserInfo memory tempUserInfo = userInfo; // to prevent stack too deep error any other recommendation?
			if (blocksToPay != 0) {
				pending =
					(tempUserInfo.effectiveStakes *
						(10**tokenDecimalDifference) *
						_accAmountPerShare) /
					1e27 -
					tempUserInfo.rewardDebt; // Turn userInfo.amount to 18 decimals by multiplying tokenDecimalDifference if it's not and multiply with accAmountPerShare which is 27 decimals then divide it 1e27 bring it down to 18 decimals
				uint256 rewardPerBlock = (pending * 1e27) / (blocksToPay * 1e18); // bring both variable to 18 decimals and multiply pending by 1e27 so when we divide them to each other result would be in 1e27
				pending =
					((((firstMonthBlocksToPay * 1e2 * 5) / 10) + fullBlocksToPay * 1e2) * // multiply first month by 0.5x (5/10) since rewards in first month with multiplier 0.5 and multiply it with 1e2 to get it 2decimals so we could get more precision
						rewardPerBlock) / // Multiply fullBlocksToPay with 1e2 to bring it to 2decimals // rewardPerBlock is in 27decimals
					1e11; // Pending in 18 decimals so we divide 1e11 to bring it down to 18 decimals
			}
		}
		return userInfo.rewardEarn + pending; // rewardEarn is in 18 decimals
	}

	/**
	 * @dev When the fundmanager calls this function it will updates the user records
	 * get the user rewards which they earned but not minted and mark it as minted
	 * @param user the user to update
	 * @param rewardsPerBlock how much rewards does this contract earns per block
	 * @param blockStart block from which contract starts earning rewards
	 * @param blockEnd block from which contract stops earning rewards
	 * @return returns amount to mint as reward to the user
	 */

	function rewardsMinted(
		address user,
		uint256 rewardsPerBlock,
		uint256 blockStart,
		uint256 blockEnd
	) public returns (uint256) {
		UserInfo storage userInfo = users[user];
		_canMintRewards();
		_update(rewardsPerBlock, blockStart, blockEnd);
		_audit(user, userInfo.amount, 1); // donationPer variable should be something different than zero so called with 1
		uint256 amount = userInfo.rewardEarn;
		userInfo.rewardEarn = 0;
		userInfo.rewardMinted += amount;
		mintedRewards = mintedRewards + amount;
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
}
