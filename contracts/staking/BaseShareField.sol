// SPDX-License-Identifier: MIT
pragma solidity >=0.6.6;
import '../Interfaces.sol';
import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/utils/math/Math.sol";
import "../utils/DAOContract.sol";
interface FundManager {
    function getStakingReward(address _staking)
        external view returns(uint,uint,uint,bool);
    
    function transferInterest(address _staking)
    external;

    function mintReward(
        address _user,
        address _staking 

     ) external;

}
contract BaseShareField is DAOContract{
    using SafeMath for uint;
  
    
    uint totalProductivity;
    uint accAmountPerShare;
    
    
    uint public mintedShare;
    uint public mintCumulation;
    uint64 constant ONE_MONTH_IN_BLOCKS = 172800;
    address public shareToken;
    
    uint public lastRewardBlock;
    
    struct UserInfo {
        uint amount;     // How many tokens the user has provided.
        uint rewardDebt; // Reward debt. 
        uint rewardEarn; // Reward earn and not minted
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

    // Update reward variables of the given pool to be up-to-date.
    function _update() internal virtual {
        if (totalProductivity == 0) {
            lastRewardBlock = block.number;
            return;
        }
        FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
        (uint rewardsPerBlock, uint blockStart, uint blockEnd, bool isBlackListed) = fm.getStakingReward(address(this));
        if(block.number >= blockStart && blockEnd>= block.number){
            uint256 multiplier = block.number - lastRewardBlock;
            uint256 reward = multiplier * (rewardsPerBlock * 1e16); // turn it to 18 decimals

            accAmountPerShare = accAmountPerShare + (reward * 1e12 / totalProductivity); 
          
            
        }
        lastRewardBlock = block.number;
    }
    
    
    // Audit user's reward to be up-to-date
    function _audit(address user) internal virtual {
        UserInfo storage userInfo = users[user];
        if (userInfo.amount > 0) {
            uint256 blocksPaid = userInfo.lastRewardTime - userInfo.multiplierResetTime; // lastRewardTime is always >= multiplierResetTime
            uint256 blocksPassedFirstMonth = Math.min(ONE_MONTH_IN_BLOCKS,block.number - userInfo.multiplierResetTime); //172800 is equivalent of month in blocks 
            uint256 blocksToPay = block.number - userInfo.lastRewardTime;
            uint256 firstMonthBlocksToPay = blocksPaid >= ONE_MONTH_IN_BLOCKS ? 0 : blocksPassedFirstMonth - blocksPaid;
            uint256 fullBlocksToPay = blocksToPay - firstMonthBlocksToPay;
            
           
            
            if (blocksToPay != 0){
                uint pending = userInfo.amount * accAmountPerShare / 1e12 - userInfo.rewardDebt;
                uint rewardPerBlock = pending * 1e22 / blocksToPay / 1e12; // increase resolution
                pending  = ((firstMonthBlocksToPay * 50 * 1e16) + fullBlocksToPay) * rewardPerBlock / 1e18; // divide 1e18 so reduce it to 18decimals
                userInfo.rewardEarn = userInfo.rewardEarn + pending;
                mintCumulation = mintCumulation + pending;
            }
            
            
        }
    }

    // External function call
    // This function increase user's productivity and updates the global productivity.
    // the users' actual share percentage will calculated by:
    // Formula:     user_productivity / global_productivity
    function _increaseProductivity(address user, uint value) internal virtual returns (bool) {
        require(value > 0, 'PRODUCTIVITY_VALUE_MUST_BE_GREATER_THAN_ZERO');

        UserInfo storage userInfo = users[user];
        _update();
        _audit(user);

        totalProductivity = totalProductivity + value;
        userInfo.lastRewardTime = uint64(block.number);
        userInfo.amount = userInfo.amount + value;
        userInfo.rewardDebt = userInfo.amount * accAmountPerShare / 1e12;
        return true;
    }

    // External function call 
    // This function will decreases user's productivity by value, and updates the global productivity
    // it will record which block this is happenning and accumulates the area of (productivity * time)
    function _decreaseProductivity(address user, uint value) internal virtual returns (bool) {
        UserInfo storage userInfo = users[user];
        require(value > 0 && userInfo.amount >= value, 'INSUFFICIENT_PRODUCTIVITY');
        
        _update();
        _audit(user);
        userInfo.lastRewardTime = uint64(block.number);
        userInfo.multiplierResetTime = uint64(block.number);
        userInfo.amount = userInfo.amount - value;
        userInfo.rewardDebt = userInfo.amount * accAmountPerShare / 1e12;
        totalProductivity = totalProductivity - value;
        
        return true;
    }
    
    function _takeWithAddress(address user) internal view returns (uint) {
        UserInfo storage userInfo = users[user];
        uint _accAmountPerShare = accAmountPerShare;
        // uint256 lpSupply = totalProductivity;
        FundManager fm = FundManager(nameService.getAddress("FUND_MANAGER"));
        uint pending = 0;
        (uint rewardsPerBlock, uint blockStart, uint blockEnd, bool isBlackListed) = fm.getStakingReward(address(this));
        if (totalProductivity != 0 && block.number >= blockStart && blockEnd>= block.number) {
            uint256 multiplier = block.number - lastRewardBlock;
            uint256 reward = multiplier * (rewardsPerBlock * 1e16); // turn it to 18 decimals
            _accAmountPerShare = _accAmountPerShare + (reward * 1e12 / totalProductivity);
            uint256 blocksPaid = userInfo.lastRewardTime - userInfo.multiplierResetTime;
            uint256 blocksPassedFirstMonth = Math.min(ONE_MONTH_IN_BLOCKS,block.number - userInfo.multiplierResetTime); //172800 is equivalent of month in blocks 
            uint256 blocksToPay = block.number - userInfo.lastRewardTime;
            uint256 firstMonthBlocksToPay = blocksPaid >= ONE_MONTH_IN_BLOCKS ? 0 : blocksPassedFirstMonth - blocksPaid;
            uint256 fullBlocksToPay = blocksToPay - firstMonthBlocksToPay;
            
           
            
            if (blocksToPay != 0){
                pending = userInfo.amount.mul(accAmountPerShare).div(1e12).sub(userInfo.rewardDebt);
                uint rewardPerBlock = pending.mul(uint256(10 ** 12)).div(blocksToPay).div(uint256(10 ** 12)); // increase resolution
                pending  = ((firstMonthBlocksToPay.mul(50*10**18).div(100)) + fullBlocksToPay).mul(rewardPerBlock).div(1e18); // divide 1e18 so reduce it to 18decimals
              
            }
            

        }
        return userInfo.rewardEarn.add(pending);
    }

    // External function call
    // When user calls this function, it will calculate how many token will mint to user from his productivity * time
    // Also it calculates global token supply from last time the user mint to this time.
    function _mint(address user) public onlyFundManager returns (uint) {
        _update();
        _audit(user);
        UserInfo storage userInfo = users[user];
        uint amount = userInfo.rewardEarn;
        userInfo.rewardEarn = 0;
        userInfo.lastRewardTime = block.number;
        userInfo.multiplierResetTime = block.number;
        mintedShare = mintedShare.add(amount);
        amount = amount.div(1e16); // change decimal of mint amount to GD decimals
        return amount;
    }

    // Returns how many productivity a user has and global has.
    function getProductivity(address user) public virtual view returns (uint, uint) {
        return (users[user].amount, totalProductivity);
    }

    // Returns the current gorss product rate.
    function interestsPerBlock() public virtual view returns (uint) {
        return accAmountPerShare;
    }
    
}