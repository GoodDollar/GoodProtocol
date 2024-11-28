// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../Interfaces.sol";
import "../utils/NameService.sol";
import "../utils/DAOUpgradeableContract.sol";

contract OneTimeReward is Ownable, DAOContract {
	bool public isActive;
	uint public rewardAmount;
	mapping(address => bool) public claimed;

	event RewardClaimed(address indexed user, uint amount);

	constructor(uint256 _rewardAmount, INameService _nameService) {
		rewardAmount = _rewardAmount;
		isActive = true;
		setDAO(_nameService);
	}

	function getIdentity() public view returns (IIdentityV2) {
		return IIdentityV2(nameService.getAddress("IDENTITY"));
	}

	function updateSettings(
		bool _isActive,
		uint _rewardAmount
	) external onlyOwner {
		isActive = _isActive;
		rewardAmount = _rewardAmount;
	}

	function checkActiveAndBalance() public view returns (bool) {
		if (!isActive) {
			return false;
		}

		if (nativeToken().balanceOf(address(this)) < rewardAmount) {
			return false;
		}

		return true;
	}

	function checkCanClaimReward(address _user) public view returns (bool) {
		address whitelistedRoot = getIdentity().getWhitelistedRoot(_user);
		return canClaimReward(whitelistedRoot);
	}

	function canClaimReward(
		address whitelistedRoot
	) internal view returns (bool) {
		if (checkActiveAndBalance() == false) {
			return false;
		}

		if (whitelistedRoot == address(0)) {
			return false;
		}

		if (claimed[whitelistedRoot]) {
			return false;
		}

		return true;
	}

	function claimReward(address _user) public {
		address whitelistedRoot = getIdentity().getWhitelistedRoot(_user);
		require(canClaimReward(whitelistedRoot), "User cannot claim reward");
		claimed[whitelistedRoot] = true;

		nativeToken().transfer(_user, rewardAmount);

		emit RewardClaimed(_user, rewardAmount);
	}

	function withdrawAll(address _token) external onlyOwner {
		uint balance = IERC20(_token).balanceOf(address(this));
		require(balance > 0, "No tokens to withdraw");

		IERC20(_token).transfer(msg.sender, balance);
	}
}
