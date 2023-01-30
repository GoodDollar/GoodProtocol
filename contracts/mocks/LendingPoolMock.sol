// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "../utils/DataTypes.sol";
pragma solidity >=0.8.0;

/**
 * @title LendingPoolMock that demonstrates behaviour of LendingPool for only single asset with aToken implemented in lendingPool
 */
contract LendingPoolMock is ERC20PresetMinterPauserUpgradeable {
	address public underlyingAsset;

	constructor(address _asset) initializer {
		underlyingAsset = _asset;
		__ERC20PresetMinterPauser_init("aUSDC", "aUSDC");
	}

	function deposit(
		address asset,
		uint256 amount,
		address onBehalfOf,
		uint16 referralCode
	) external {
		referralCode;
		require(
			asset == underlyingAsset,
			"asset should be same with set underlying asset"
		);
		ERC20Upgradeable(asset).transferFrom(msg.sender, address(this), amount);
		_mint(onBehalfOf, amount);
	}

	function withdraw(
		address asset,
		uint256 amount,
		address to
	) external returns (uint256) {
		require(
			asset == underlyingAsset,
			"asset should be same with set underlying asset"
		);
		_burn(msg.sender, amount);

		ERC20Upgradeable(asset).transfer(to, amount);
		return amount;
	}

	function decimals() public pure override returns (uint8) {
		return 6;
	}

	function getReserveData(address asset)
		external
		view
		returns (DataTypes.ReserveData memory)
	{
		asset;
		DataTypes.ReserveData memory reserve;
		reserve.aTokenAddress = address(this);
		return reserve;
	}

	function giveInterestToUser(uint256 _amount, address _recipient) external {
		_mint(_recipient, (balanceOf(_recipient) * (100 + _amount)) / 100);
	}
}
