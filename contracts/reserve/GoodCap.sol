// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "../utils/DAOContract.sol";
import "../utils/NameService.sol";

import "../DAOStackInterfaces.sol";
import "../Interfaces.sol";

/**
@title GoodDollar token minting manager, should be the single minter, and all minting go through it
*/

contract GoodCap is Initializable, AccessControlUpgradeable, DAOContract {
	using SafeMathUpgradeable for uint256;
	bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

	GoodDollar goodDollar;

	uint256 public cap;

	mapping(address => uint256) public mintCaps;

	function initialize(NameService _ns, uint256 _cap)
		public
		virtual
		initializer
	{
		setDAO(_ns); //this must be first, so avatar variable is set
		__AccessControl_init();
		_setupRole(DEFAULT_ADMIN_ROLE, address(avatar)); //only Avatar can manage minters

		cap = _cap;
		goodDollar = GoodDollar(avatar.nativeToken());
	}

	/**
	 * @dev return true if msg sender is one of the default minters
	 */

	function isCoreMinter() public view returns (bool) {
		return
			_msgSender() ==
			nameService.getAddressByHash(nameService.RESERVE()) ||
			_msgSender() ==
			nameService.getAddressByHash(nameService.FUND_MANAGER());
	}

	/**
	 * @dev mint G$s if has permissions
	 */
	function mint(address _to, uint256 _amount) public {
		require(
			isCoreMinter() || hasRole(MINTER_ROLE, _msgSender()),
			"GoodCap: not a minter"
		);

		require(
			goodDollar.totalSupply().add(_amount) <= cap,
			"GoodCap: cap enforced"
		);

		goodDollar.mint(_to, _amount);
	}
}
