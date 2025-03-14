// SPDX-License-Identifier: MIT
// we use a custom file and not openzeppelin directly since the DAOStack Controller expects `mint` to return bool
// we also add the erc20 permit

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @dev {ERC20} token, including:
 *
 *  - ability for holders to burn (destroy) their tokens
 *  - a minter role that allows for token minting (creation)
 *  - a pauser role that allows to stop all token transfers
 *
 * This contract uses {AccessControl} to lock permissioned functions using the
 * different roles - head to its documentation for details.
 *
 * The account that deploys the contract will be granted the minter and pauser
 * roles, as well as the default admin role, which will let it grant both minter
 * and pauser roles to other accounts.
 */
contract ERC20PresetMinterPauserUpgradeable is
	Initializable,
	ContextUpgradeable,
	AccessControlEnumerableUpgradeable,
	ERC20PermitUpgradeable,
	ERC20BurnableUpgradeable,
	ERC20PausableUpgradeable
{
	function initialize(string memory name, string memory symbol)
		public
		virtual
		initializer
	{
		__ERC20PresetMinterPauser_init(name, symbol);
	}

	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
	bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

	/**
	 * @dev Grants `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE` and `PAUSER_ROLE` to the
	 * account that deploys the contract.
	 *
	 * See {ERC20-constructor}.
	 */
	function __ERC20PresetMinterPauser_init(
		string memory name,
		string memory symbol
	) internal initializer {
		__Context_init_unchained();
		__ERC165_init_unchained();
		__AccessControl_init_unchained();
		__AccessControlEnumerable_init_unchained();
		__ERC20_init_unchained(name, symbol);
		__ERC20Burnable_init_unchained();
		__Pausable_init_unchained();
		__ERC20Pausable_init_unchained();
		__ERC20PresetMinterPauser_init_unchained(name, symbol);
		__ERC20Permit_init_unchained(name);
	}

	function __ERC20PresetMinterPauser_init_unchained(
		string memory name,
		string memory symbol
	) internal initializer {
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

		_setupRole(MINTER_ROLE, _msgSender());
		_setupRole(PAUSER_ROLE, _msgSender());
	}

	/**
	 * @dev Creates `amount` new tokens for `to`.
	 *
	 * See {ERC20-_mint}.
	 *
	 * Requirements:
	 *
	 * - the caller must have the `MINTER_ROLE`.
	 */
	function mint(address to, uint256 amount) public virtual returns (bool) {
		require(
			hasRole(MINTER_ROLE, _msgSender()),
			"ERC20PresetMinterPauser: must have minter role to mint"
		);
		_mint(to, amount);
		return true;
	}

	/**
	 * @dev Pauses all token transfers.
	 *
	 * See {ERC20Pausable} and {Pausable-_pause}.
	 *
	 * Requirements:
	 *
	 * - the caller must have the `PAUSER_ROLE`.
	 */
	function pause() public virtual {
		require(
			hasRole(PAUSER_ROLE, _msgSender()),
			"ERC20PresetMinterPauser: must have pauser role to pause"
		);
		_pause();
	}

	/**
	 * @dev Unpauses all token transfers.
	 *
	 * See {ERC20Pausable} and {Pausable-_unpause}.
	 *
	 * Requirements:
	 *
	 * - the caller must have the `PAUSER_ROLE`.
	 */
	function unpause() public virtual {
		require(
			hasRole(PAUSER_ROLE, _msgSender()),
			"ERC20PresetMinterPauser: must have pauser role to unpause"
		);
		_unpause();
	}

	function _beforeTokenTransfer(
		address from,
		address to,
		uint256 amount
	) internal virtual override(ERC20Upgradeable, ERC20PausableUpgradeable) {
		super._beforeTokenTransfer(from, to, amount);
	}

	uint256[50] private __gap;
}
