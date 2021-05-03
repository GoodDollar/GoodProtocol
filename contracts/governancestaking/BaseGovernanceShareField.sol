// SPDX-License-Identifier: MIT
pragma solidity >=0.6.6;
import "../Interfaces.sol";
import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/utils/math/Math.sol";
import "../utils/DAOContract.sol";
import "../utils/DSMath.sol";


contract BaseGovernanceShareField is DAOContract {
	using SafeMath for uint256;

	uint256 totalProductivity;
	uint256 accAmountPerShare;

	uint256 public mintedShare;
	uint256 public mintCumulation;
	address public shareToken;

	uint256 public lastRewardBlock;
    uint256 public rewardsPerBlock;

	struct UserInfo {
		uint256 amount; // How many tokens the user has provided.
		uint256 rewardDebt; // Reward debt.
		uint256 rewardEarn; // Reward earn and not minted
	}

	mapping(address => UserInfo) public users;

	function setRewardsPerBlock (uint256 _rewardsPerBlock) public{
        _onlyAvatar();
        rewardsPerBlock = _rewardsPerBlock;
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
		
		
        uint256 multiplier = block.number - lastRewardBlock; // Blocks passed since last reward block
        uint256 reward = multiplier * (rewardsPerBlock * 1e16); // rewardsPerBlock is in G$ which is only 2 decimals, we turn it into 18 decimals by multiplying 1e16

        accAmountPerShare =accAmountPerShare + rdiv(reward  , totalProductivity) / 1e9; // divide 1e9 so reduce to 18 decimals
        
    
        lastRewardBlock = block.number;
	}

	/**
	 * @dev Audit user's rewards and calculate their earned rewards based on stake_amount * accAmountPerShare
	 */
	function _audit(address user) internal virtual {
		UserInfo storage userInfo = users[user];
		if (userInfo.amount > 0) {
		
				uint256 pending =
					(userInfo.amount * accAmountPerShare) /
						1e18 -
						userInfo.rewardDebt; // Divide 1e18 to reduce 18 Decimals since rewardDebt in 18 decimals so we can calculate how much reward earned in that cycle
				
				userInfo.rewardEarn = userInfo.rewardEarn + pending; // Add user's earned rewards to user's account so it can be minted later
				mintCumulation = mintCumulation + pending;
			}
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
		userInfo.amount = userInfo.amount + value;
		userInfo.rewardDebt = (userInfo.amount * accAmountPerShare) / 1e18; // Divide to 1e18 to keep rewardDebt in 18 decimals
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
	
		uint256 pending = 0;
	
		if (totalProductivity != 0) 
        {
			uint256 multiplier = block.number - lastRewardBlock;
			uint256 reward = multiplier * (rewardsPerBlock * 1e16); // turn it to 18 decimals since rewardsPerBlock in 2 decimals
		

			_accAmountPerShare =
				_accAmountPerShare +
				rdiv(reward  , totalProductivity) / 1e9; // divide 1e9 so reduce to 18 decimals
			UserInfo memory tempUserInfo = userInfo; // to prevent stack too deep error any other recommendation?
			
				pending =
					(tempUserInfo.amount * _accAmountPerShare) /
					1e18 -
					tempUserInfo.rewardDebt; // Divide 1e18 to reduce 18 Decimals since rewardDebt in 18 decimals so we can calculate how much reward earned in that cycle
				
			
		}
		return userInfo.rewardEarn + pending / 1e16; // Reward earn in 18decimals so need to divide 1e16 to bring down gd decimals which is 2
	}

	/** 
    @dev When the fundmanager calls this function it will updates the user records 
    * get the user rewards which they earned but not minted and mark it as minted 
    * @param user address of the user that will be accounted
    * @return returns amount to mint as reward to the user
    */

	function rewardsMinted(address user)
		public
		returns (uint256)
	{
		_update();
		_audit(user);
		UserInfo storage userInfo = users[user];
		uint256 amount = userInfo.rewardEarn;
		userInfo.rewardEarn = 0;
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
    function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
		z = x.mul(y).add(10**27 / 2) / 10**27;
	}

	function rdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
		z = x.mul(10**27).add(y / 2) / y;
	}
}
