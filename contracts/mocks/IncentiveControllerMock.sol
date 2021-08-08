// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;
import "./AaveMock.sol";

contract IncentiveControllerMock {
	AaveMock public aave;
	mapping(address => uint256) rewards;

	constructor(AaveMock _aave) {
		aave = _aave;
	}

	function claimRewards(
		address[] calldata assets,
		uint256 amount,
		address to
	) external returns (uint256) {
		assets; //warning
		if (rewards[msg.sender] < amount) amount = rewards[msg.sender];
		aave.mint(to, amount);
		rewards[msg.sender] -= amount;
		return amount;
	}

	// @inheritdoc IAaveIncentivesController
	function getRewardsBalance(address[] calldata assets, address user)
		external
		view
		returns (uint256)
	{
		assets;
		return rewards[user];
	}

	function increaseRewardsBalance(address user, uint256 _amount) external {
		rewards[user] += _amount;
	}
}
