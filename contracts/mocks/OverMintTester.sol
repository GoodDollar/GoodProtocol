// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "../governance/GovernanceStaking.sol";

interface IGoodDollarStakingTest {
	function stake(uint256 amount) external;

	function stake(uint256 amount, uint32 ratio) external;

	function withdrawRewards() external;
}

contract OverMintTester {
	ERC20 public stakingToken;
	IGoodDollarStakingTest public stakingContract;
	ERC20 public rewardToken;

	constructor(
		ERC20 _stakingToken,
		IGoodDollarStakingTest _stakingContract,
		ERC20 _rewardToken
	) {
		stakingToken = _stakingToken;
		stakingContract = _stakingContract;
		rewardToken = _rewardToken;
	}

	function stake() external {
		uint256 tokenBalance = stakingToken.balanceOf(address(this));
		stakingToken.approve(address(stakingContract), tokenBalance);
		try stakingContract.stake(tokenBalance, 0) {} catch {
			stakingContract.stake(tokenBalance);
		}
	}

	function overMintTest() external {
		stakingContract.withdrawRewards();
		uint256 tokenBalance = rewardToken.balanceOf(address(this));
		require(tokenBalance != 0, "Reward token balance should not be equal 0");
		stakingContract.withdrawRewards();
		uint256 tokenBalanceAfterSecondClaim = rewardToken.balanceOf(address(this));
		require(
			tokenBalance == tokenBalanceAfterSecondClaim,
			"It should not overmint rewards"
		);
	}
}
