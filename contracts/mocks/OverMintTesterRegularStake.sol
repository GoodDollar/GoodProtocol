// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../staking/SimpleStaking.sol";

contract OverMintTesterRegularStake {
    ERC20 public stakingToken;
    SimpleStaking public stakingContract;
    ERC20 public rewardToken;

    constructor (ERC20 _stakingToken ,SimpleStaking _stakingContract,ERC20 _rewardToken){
        stakingToken = _stakingToken;
        stakingContract = _stakingContract;
        rewardToken = _rewardToken;

    }

    function stake()external{
       
        uint256 tokenBalance = stakingToken.balanceOf(address(this));
        stakingToken.approve(address(stakingContract),tokenBalance);
        stakingContract.stake(tokenBalance,0,false);

    }
    function overMintTest()external{
        stakingContract.withdrawRewards();
        uint256 tokenBalance = rewardToken.balanceOf(address(this));
        require(tokenBalance != 0,"Reward token balance should not be equal 0");
        stakingContract.withdrawRewards();
        uint256 tokenBalanceAfterSecondClaim = rewardToken.balanceOf(address(this));
        require (tokenBalance == tokenBalanceAfterSecondClaim,"It should not overmint rewards");
    }
    
}