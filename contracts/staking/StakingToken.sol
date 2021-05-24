// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;
import "./BaseShareField.sol";

contract StakingToken is BaseShareField {
	using SafeMath for uint256;

	string public name;
	string public symbol;
	uint8 public decimals;
	uint256 public totalSupply;

	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;

	event Mint(address indexed user, uint256 amount);
	event Transfer(address indexed from, address indexed to, uint256 value);
	event Approval(
		address indexed owner,
		address indexed spender,
		uint256 value
	);

	function _mint(address to, uint256 value) internal {
		totalSupply = totalSupply.add(value);
		balanceOf[to] = balanceOf[to].add(value);
		emit Transfer(address(0), to, value);
	}

	constructor(string memory _name, string memory _symbol) {
		name = _name;
		symbol = _symbol;
	}

	receive() external payable {}

	function _burn(address from, uint256 value) internal {
		balanceOf[from] = balanceOf[from].sub(value);
		totalSupply = totalSupply.sub(value);
		emit Transfer(from, address(0), value);
	}

	function _transfer(
		address from,
		address to,
		uint256 value
	) internal virtual {
		require(balanceOf[from] >= value, "ERC20Token: INSUFFICIENT_BALANCE");
		balanceOf[from] = balanceOf[from].sub(value);
		balanceOf[to] = balanceOf[to].add(value);
		if (to == address(0)) {
			// burn
			totalSupply = totalSupply.sub(value);
		}

		_decreaseProductivity(from, value);
		_increaseProductivity(to, value);
		emit Transfer(from, to, value);
	}

	function approve(address spender, uint256 value) external returns (bool) {
		allowance[msg.sender][spender] = value;
		emit Approval(msg.sender, spender, value);
		return true;
	}

	function transfer(address to, uint256 value) external returns (bool) {
		_transfer(msg.sender, to, value);
		return true;
	}

	function transferFrom(
		address from,
		address to,
		uint256 value
	) external returns (bool) {
		require(
			allowance[from][msg.sender] >= value,
			"ERC20Token: INSUFFICIENT_ALLOWANCE"
		);
		allowance[from][msg.sender] = allowance[from][msg.sender].sub(value);
		_transfer(from, to, value);
		return true;
	}
}
