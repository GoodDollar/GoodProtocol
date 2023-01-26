// SPDX-License-Identifier: MIT

pragma solidity >=0.8;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-IERC20PermitUpgradeable.sol";

import "./SuperToken.sol";

interface SelfApprove {
	function selfApproveFor(
		address account,
		address spender,
		uint256 amount
	) external;
}

abstract contract ERC20Permit is IERC20PermitUpgradeable, EIP712Upgradeable {
	mapping(address => uint256) private _nonces;

	// solhint-disable-next-line var-name-mixedcase
	bytes32 private _PERMIT_TYPEHASH;

	/**
	 * @dev Initializes the {EIP712} domain separator using the `name` parameter, and setting `version` to `"1"`.
	 *
	 * It's a good idea to use the same `name` that is defined as the ERC20 token name.
	 */
	function __ERC20Permit_init(string memory name) internal onlyInitializing {
		__EIP712_init_unchained(name, "1");
		__ERC20Permit_init_unchained(name);
	}

	function __ERC20Permit_init_unchained(string memory name)
		internal
		onlyInitializing
	{
		_PERMIT_TYPEHASH = keccak256(
			"Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
		);
	}

	/**
	 * @dev See {IERC20Permit-permit}.
	 */
	function permit(
		address owner,
		address spender,
		uint256 value,
		uint256 deadline,
		uint8 v,
		bytes32 r,
		bytes32 s
	) public virtual {
		require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

		bytes32 structHash = keccak256(
			abi.encode(
				_PERMIT_TYPEHASH,
				owner,
				spender,
				value,
				_useNonce(owner),
				deadline
			)
		);

		bytes32 hash = _hashTypedDataV4(structHash);

		address signer = ECDSAUpgradeable.recover(hash, v, r, s);
		require(signer == owner, "ERC20Permit: invalid signature");

		SelfApprove(address(this)).selfApproveFor(owner, spender, value);
	}

	/**
	 * @dev See {IERC20Permit-nonces}.
	 */
	function nonces(address owner) public view virtual returns (uint256) {
		return _nonces[owner];
	}

	/**
	 * @dev See {IERC20Permit-DOMAIN_SEPARATOR}.
	 */
	// solhint-disable-next-line func-name-mixedcase
	function DOMAIN_SEPARATOR() external view returns (bytes32) {
		return _domainSeparatorV4();
	}

	/**
	 * @dev "Consume a nonce": return the current value and increment.
	 *
	 * _Available since v4.1._
	 */

	function _useNonce(address owner) internal virtual returns (uint256 current) {
		current = _nonces[owner];
		_nonces[owner]++;
	}
}
