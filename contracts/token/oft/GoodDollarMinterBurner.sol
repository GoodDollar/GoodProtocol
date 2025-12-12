// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import {ISuperGoodDollar} from "../superfluid/ISuperGoodDollar.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract GoodDollarMinterBurner is Ownable {
    ISuperGoodDollar public immutable token;
    mapping(address => bool) public operators;

    modifier onlyOperators() {
        require(operators[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    constructor(ISuperGoodDollar _token, address _owner) Ownable() {
        token = _token;
        _transferOwnership(_owner);
    }

    function setOperator(address _operator, bool _status) external onlyOwner {
        operators[_operator] = _status;
    }

    function burn(address _from, uint256 _amount) external onlyOperators returns (bool) {
        token.burnFrom(_from, _amount);
        return true;
    }

    function mint(address _to, uint256 _amount) external onlyOperators returns (bool) {
        return token.mint(_to, _amount);
    }
}