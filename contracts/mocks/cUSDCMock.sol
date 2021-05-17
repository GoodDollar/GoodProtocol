// SPDX-License-Identifier: MIT

pragma solidity >0.5.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../utils/DSMath.sol";

contract cUSDCMock is DSMath, ERC20PresetMinterPauserUpgradeable {
	using SafeMathUpgradeable for uint256;

	ERC20PresetMinterPauserUpgradeable usdc;

	uint256 exchangeRate = uint256(100e16).div(99);

	constructor(ERC20PresetMinterPauserUpgradeable _usdc) {
		__ERC20PresetMinterPauser_init("Compound USDC", "cUSDC");
		usdc = _usdc;
	}

	function mint(uint256 usdcAmount) public returns (uint256) {
		usdc.transferFrom(msg.sender, address(this), usdcAmount);
		//mul by 1e10 to match to precision of 1e16 of the exchange rate
		_mint(
			msg.sender,
			rdiv(usdcAmount * 1e10, exchangeRateStored()).div(1e19)
		); //div to reduce precision from RAY 1e27 to 1e8 precision of cDAI
		return 0;
	}

	function redeem(uint256 cUsdcAmount) public returns (uint256) {
		uint256 usdcAmount = (cUsdcAmount / 1e2) * exchangeRateStored() / 1e16;

		_burn(msg.sender, cUsdcAmount);
		usdc.transfer(msg.sender, usdcAmount);
		return 0;
	}

	function redeemUnderlying(uint256 usdcAmount) public returns (uint256) {
		uint256 cUsdcAmount =
			rdiv(usdcAmount * 1e10, exchangeRateStored()).div(1e19);
		_burn(msg.sender, cUsdcAmount);
		usdc.transfer(msg.sender, usdcAmount);
		return 0;
	}

	function exchangeRateCurrent() public returns (uint256) {
		exchangeRate += uint256(1e16).div(100);
		return exchangeRate;
	}

	function exchangeRateStored() public view returns (uint256) {
		return exchangeRate;
	}

	function decimals() public pure override returns (uint8) {
		return 8;
	}

	function increasePriceWithMultiplier(uint256 multiplier) public {
		exchangeRate += multiplier * uint256(1e16).div(100);
	}
}
