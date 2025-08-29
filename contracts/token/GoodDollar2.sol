// SPDX-License-Identifier: MIT

import "./GoodDollar.sol";

/**
 * @title The GoodDollar V2 ERC677 token contract
 */

contract GoodDollar2 is GoodDollar {
	function decimals() public view virtual override returns (uint8) {
		return 2;
	}
}
