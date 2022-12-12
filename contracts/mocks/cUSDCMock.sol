// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../utils/DSMath.sol";

contract cUSDCMock is DSMath, ERC20PresetMinterPauserUpgradeable {
	using SafeMathUpgradeable for uint256;

	ERC20PresetMinterPauserUpgradeable usdc;

	uint256 exchangeRate = 200000000000000; // initial exchange rate 0.02 from original cToken
	uint256 mantissa = 16;

	constructor(ERC20PresetMinterPauserUpgradeable _usdc) initializer {
		__ERC20PresetMinterPauser_init("Compound USDC", "cUSDC");
		usdc = _usdc;
	}

	function mint(uint256 usdcAmount) public returns (uint256) {
		usdc.transferFrom(msg.sender, address(this), usdcAmount);

		_mint(
			msg.sender,
			(usdcAmount * 1e2 * (10**mantissa)) / exchangeRateStored() // based on https://compound.finance/docs#protocol-math
		);
		return 0;
	}

	function redeem(uint256 cUsdcAmount) public returns (uint256) {
		uint256 usdcAmount = ((cUsdcAmount / 1e2) * exchangeRateStored()) /
			10**mantissa; // based on https://compound.finance/docs#protocol-math

		_burn(msg.sender, cUsdcAmount);
		usdc.transfer(msg.sender, usdcAmount);
		return 0;
	}

	function redeemUnderlying(uint256 usdcAmount) public returns (uint256) {
		uint256 cUsdcAmount = (usdcAmount * 1e2 * (10**mantissa)) /
			exchangeRateStored(); // based on https://compound.finance/docs#protocol-math
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
