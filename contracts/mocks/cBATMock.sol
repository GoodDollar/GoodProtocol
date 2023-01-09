// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../utils/DSMath.sol";

contract cBATMock is DSMath, ERC20PresetMinterPauserUpgradeable {
	using SafeMathUpgradeable for uint256;

	ERC20PresetMinterPauserUpgradeable bat;

	uint256 exchangeRate = uint256(100e28).div(99);

	constructor(ERC20PresetMinterPauserUpgradeable _bat) initializer {
		__ERC20PresetMinterPauser_init("Compound BAT", "cBAT");
		bat = _bat;
	}

	function mint(uint256 batAmount) public returns (uint256) {
		bat.transferFrom(msg.sender, address(this), batAmount);
		//mul by 1e10 to match to precision of 1e28 of the exchange rate
		_mint(msg.sender, rdiv(batAmount * 1e10, exchangeRateStored()).div(1e19)); //div to reduce precision from RAY 1e27 to 1e8 precision of cDAI
		return 0;
	}

	function redeem(uint256 cBatAmount) public returns (uint256) {
		uint256 daiAmount = rmul(
			cBatAmount * 1e10, //bring cdai 8 decimals to rdai precision
			exchangeRateStored().div(10)
		);
		//div to reduce precision from 1e28 of exchange rate to 1e27 that DSMath works on
		// uint256 daiAmount = cdaiAmount.mul(100).div(99);
		_burn(msg.sender, cBatAmount);
		bat.transfer(msg.sender, daiAmount);
		return 0;
	}

	function redeemUnderlying(uint256 batAmount) public returns (uint256) {
		uint256 cdaiAmount = rdiv(batAmount * 1e10, exchangeRateStored()).div(1e19);
		_burn(msg.sender, cdaiAmount);
		bat.transfer(msg.sender, batAmount);
		return 0;
	}

	function exchangeRateCurrent() public returns (uint256) {
		exchangeRate += uint256(1e28).div(100);
		return exchangeRate;
	}

	function exchangeRateStored() public view returns (uint256) {
		return exchangeRate;
	}

	function decimals() public pure override returns (uint8) {
		return 8;
	}

	function increasePriceWithMultiplier(uint256 multiplier) public {
		exchangeRate += multiplier * uint256(1e28).div(100);
	}
}
