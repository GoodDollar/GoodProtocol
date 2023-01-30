// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../utils/DSMath.sol";

contract cDecimalsMock is DSMath, ERC20PresetMinterPauserUpgradeable {
	using SafeMathUpgradeable for uint256;

	ERC20PresetMinterPauserUpgradeable edt;

	uint256 exchangeRate = 20000000000000000; // initial exchange rate 0.02 from original cToken
	uint256 mantissa = 18;

	constructor(ERC20PresetMinterPauserUpgradeable _edt) initializer {
		__ERC20PresetMinterPauser_init("Compound EDT", "cEDT");
		edt = _edt;
		mantissa = 18 + _edt.decimals() - 8;
	}

	function mint(uint256 edtAmount) public returns (uint256) {
		edt.transferFrom(msg.sender, address(this), edtAmount);
		uint256 decimalsDifference = edt.decimals() >= 8
			? edt.decimals() - 8
			: 8 - edt.decimals();
		bool caseType = edt.decimals() >= 8;
		//mul by 1e10 to match to precision of 1e16 of the exchange rate
		_mint(
			msg.sender,
			caseType
				? ((edtAmount / (10**decimalsDifference)) * (10**mantissa)) /
					exchangeRateStored()
				: (edtAmount * (10**decimalsDifference) * (10**mantissa)) /
					exchangeRateStored() // based on https://compound.finance/docs#protocol-math
		);
		return 0;
	}

	function redeem(uint256 cEdtAmount) public returns (uint256) {
		uint256 decimalsDifference = edt.decimals() >= 8
			? edt.decimals() - 8
			: 8 - edt.decimals();
		bool caseType = edt.decimals() >= 8;
		uint256 edtAmount = caseType
			? (cEdtAmount * 10**decimalsDifference * exchangeRateStored()) /
				10**mantissa
			: ((cEdtAmount / 10**decimalsDifference) * exchangeRateStored()) /
				10**mantissa; // based on https://compound.finance/docs#protocol-math

		_burn(msg.sender, cEdtAmount);
		edt.transfer(msg.sender, edtAmount);
		return 0;
	}

	function redeemUnderlying(uint256 edtAmount) public returns (uint256) {
		uint256 decimalsDifference = edt.decimals() >= 8
			? edt.decimals() - 8
			: 8 - edt.decimals();
		bool caseType = edt.decimals() >= 8;
		uint256 cEdtAmount = caseType
			? ((edtAmount / (10**decimalsDifference)) * (10**mantissa)) /
				exchangeRateStored()
			: (edtAmount * (10**decimalsDifference) * (10**mantissa)) /
				exchangeRateStored(); // based on https://compound.finance/docs#protocol-math
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
