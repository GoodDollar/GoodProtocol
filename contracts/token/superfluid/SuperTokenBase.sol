// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import { ISuperToken, CustomSuperTokenBase } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/CustomSuperTokenBase.sol";

/**
 * This contract wraps SuperToken functions into internal functions.
 * This makes it more convenient to invoke them from the context of a delegate call
 * and to override them in another logic contract (call the wrapper instead of super.fn()).
 * The invoker of this functions is responsible for the required permission checks.
 * Occupies storage slots through the base contract
 */
abstract contract SuperTokenBase is CustomSuperTokenBase {
	function _name() internal view returns (string memory name) {
		return ISuperToken(address(this)).name();
	}

	function _totalSupply() internal view returns (uint256 totalSupply) {
		return ISuperToken(address(this)).totalSupply();
	}

	function _mint(
		address account,
		uint256 amount,
		bytes memory userData
	) internal {
		ISuperToken(address(this)).selfMint(account, amount, userData);
	}

	function _burn(
		address from,
		uint256 amount,
		bytes memory userData
	) internal {
		ISuperToken(address(this)).selfBurn(from, amount, userData);
	}

	function _approve(
		address account,
		address spender,
		uint256 amount
	) internal {
		ISuperToken(address(this)).selfApproveFor(account, spender, amount);
	}

	function _transferFrom(
		address holder,
		address spender,
		address recipient,
		uint256 amount
	) internal {
		ISuperToken(address(this)).selfTransferFrom(
			holder,
			spender,
			recipient,
			amount
		);
	}

	function _balanceOf(address account) internal view returns (uint256 balance) {
		return ISuperToken(address(this)).balanceOf(account);
	}

	function _allowance(address owner, address spender)
		internal
		view
		returns (uint256)
	{
		return ISuperToken(address(this)).allowance(owner, spender);
	}

	function _createAgreement(bytes32 id, bytes32[] calldata data) internal {
		ISuperToken(address(this)).createAgreement(id, data);
	}
}
