// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../IConsensus.sol";

contract ValidatorsManagement {
	address[] public validators;

	IConsensus public consensus;

	function _addValidator(address _v) internal {
		validators.push(_v);
	}

	function _removeValidator(address _validator) internal {
		uint256 delegated = consensus.delegatedAmount(address(this), _validator);
		if (delegated > 0) {
			uint256 prevBalance = _balance();
			_safeUndelegate(_validator, delegated);

			// wasnt withdrawn because validator needs to be taken of active validators
			if (_balance() == prevBalance) {
				// pendingValidators.push(_validator);
				return;
			}
		}

		for (uint256 i = 0; i < validators.length; i++) {
			if (validators[i] == _validator) {
				if (i < validators.length - 1)
					validators[i] = validators[validators.length - 1];
				validators.pop();
				break;
			}
		}
	}

	function _gatherFuseFromValidators(uint256 _value) internal {
		uint256 toCollect = _value;
		uint256 perValidator = _value / validators.length;
		for (uint256 i = 0; i < validators.length; i++) {
			uint256 cur = consensus.delegatedAmount(address(this), validators[i]);
			if (cur == 0) continue;
			if (cur <= perValidator) {
				_safeUndelegate(validators[i], cur);
				toCollect = toCollect - cur;
			} else {
				_safeUndelegate(validators[i], perValidator);
				toCollect = toCollect - perValidator;
			}
			if (toCollect == 0) break;
		}
	}

	function _stakeNextValidator(uint256 _value, address _validator)
		internal
		returns (bool)
	{
		if (validators.length == 0) return false;
		if (_validator != address(0)) {
			consensus.delegate{ value: _value }(_validator);
			return true;
		}

		uint256 perValidator = (totalDelegated() + _value) / validators.length;
		uint256 left = _value;
		for (uint256 i = 0; i < validators.length && left > 0; i++) {
			uint256 cur = consensus.delegatedAmount(address(this), validators[i]);

			if (cur < perValidator) {
				uint256 toDelegate = perValidator - cur;
				toDelegate = toDelegate < left ? toDelegate : left;
				consensus.delegate{ value: toDelegate }(validators[i]);
				left = left - toDelegate;
			}
		}

		return true;
	}

	function _requireValidValidator(address _validator) internal view {
		require(validators.length > 0, "no approved validators");
		bool found;
		for (
			uint256 i = 0;
			_validator != address(0) && i < validators.length;
			i++
		) {
			if (validators[i] != _validator) {
				found = true;
				break;
			}
		}
		require(
			_validator == address(0) || found,
			"validator not in approved list"
		);
	}

	function totalDelegated() public view returns (uint256) {
		uint256 total = 0;
		for (uint256 i = 0; i < validators.length; i++) {
			uint256 cur = consensus.delegatedAmount(address(this), validators[i]);
			total += cur;
		}
		return total;
	}

	function _safeUndelegate(address _validator, uint256 _amount)
		internal
		returns (bool)
	{
		try consensus.withdraw(_validator, _amount) {
			return true;
		} catch Error(
			string memory /*reason*/
		) {
			// This is executed in case
			// revert was called inside getData
			// and a reason string was provided.
			return false;
		} catch (
			bytes memory /*lowLevelData*/
		) {
			// This is executed in case revert() was used
			// or there was a failing assertion, division
			// by zero, etc. inside getData.
			return false;
		}
	}

	function _balance() internal view returns (uint256) {
		return address(this).balance;
	}
}
