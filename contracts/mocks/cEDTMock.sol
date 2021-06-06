// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../utils/DSMath.sol";

contract cEDTMock is DSMath, ERC20PresetMinterPauserUpgradeable {
	using SafeMathUpgradeable for uint256;

	ERC20PresetMinterPauserUpgradeable edt;

	uint256 exchangeRate = 20000000000000000; // initial exchange rate 0.02 from original cToken
	uint256 mantissa = 18;

	constructor(ERC20PresetMinterPauserUpgradeable _edt) {
		__ERC20PresetMinterPauser_init("Compound EDT", "cEDT");
		edt = _edt;
	}

	function mint(uint256 edtAmount) public returns (uint256) {
		edt.transferFrom(msg.sender, address(this), edtAmount);
		//mul by 1e10 to match to precision of 1e16 of the exchange rate
		_mint(
			msg.sender,
			(edtAmount * (10**mantissa)) / exchangeRateStored() // based on https://compound.finance/docs#protocol-math
		);
		return 0;
	}

	function redeem(uint256 cEdtAmount) public returns (uint256) {
		uint256 edtAmount = (cEdtAmount * exchangeRateStored()) / 1e18; // based on https://compound.finance/docs#protocol-math

		_burn(msg.sender, cEdtAmount);
		edt.transfer(msg.sender, edtAmount);
		return 0;
	}

	function redeemUnderlying(uint256 edtAmount) public returns (uint256) {
		uint256 cEdtAmount =
			(edtAmount * (10**mantissa)) / exchangeRateStored(); // based on https://compound.finance/docs#protocol-math
		_burn(msg.sender, cEdtAmount);
		edt.transfer(msg.sender, edtAmount);
		return 0;
	}

	function exchangeRateCurrent() public returns (uint256) {
		exchangeRate += uint256(1e18).div(100);
		return exchangeRate;
	}

	function exchangeRateStored() public view returns (uint256) {
		return exchangeRate;
	}

	function decimals() public pure override returns (uint8) {
		return 8;
	}

	function increasePriceWithMultiplier(uint256 multiplier) public {
		exchangeRate += multiplier * uint256(1e18).div(100);
	}
}
