// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../governance/GovarnanceStaking.sol";

contract OverMintTester {
    ERC20 public stakingToken;
    GovernanceStaking public stakingContract;

    constructor (ERC20 _stakingToken ,GovernanceStaking _stakingContract){
        stakingToken = _stakingToken;
        stakingContract = _stakingContract;
    }

    function stake()external{
       
        uint256 tokenBalance = stakingToken.balanceOf(address(this));
        stakingToken.approve(address(stakingContract),tokenBalance);
        stakingContract.stake(tokenBalance);

    }
    function overMintTest()external{
        stakingContract.withdrawRewards();
        uint256 tokenBalance = stakingToken.balanceOf(address(this));
        stakingContract.withdrawRewards();
        uint256 tokenBalanceAfterSecondClaim = stakingToken.balanceOf(address(this));
        require (tokenBalance == tokenBalanceAfterSecondClaim,"It should not overmint rewards");
    }
    
}