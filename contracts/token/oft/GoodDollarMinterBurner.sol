// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import {ISuperGoodDollar} from "../superfluid/ISuperGoodDollar.sol";
import "../../utils/DAOUpgradeableContract.sol";

/**
 * @title GoodDollarMinterBurner
 * @dev DAO-upgradeable contract that handles minting and burning of GoodDollar tokens for OFT
 * 
 * This contract is used by the GoodDollarOFTAdapter to mint and burn tokens during
 * cross-chain transfers via LayerZero. It is upgradeable and controlled by the DAO.
 * 
 * Key functionalities:
 * - Mint tokens when receiving cross-chain transfers
 * - Burn tokens when sending cross-chain transfers
 * - Manage operators (like OFT adapter) that can mint/burn
 * - Pause functionality for emergency situations
 * - Upgradeable via DAO governance
 */
contract GoodDollarMinterBurner is DAOUpgradeableContract {
    ISuperGoodDollar public token;
    mapping(address => bool) public operators;
    
    bool public paused;
    

    event OperatorSet(address indexed operator, bool status);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    
    modifier onlyOperators() {
        require(operators[msg.sender] || msg.sender == avatar, "Not authorized");
        require(!paused, "Contract is paused");
        _;
    }
    
    /**
     * @dev Initialize the MinterBurner contract
     * @param _token The address of the GoodDollar token contract
     * @param _nameService The NameService contract for DAO integration
     */
    function initialize(
        ISuperGoodDollar _token,
        INameService _nameService
    ) public initializer {
        require(address(_token) != address(0), "Token address cannot be zero");
        token = _token;
        setDAO(_nameService);
    }

    /**
     * @dev Set or remove an operator that can mint/burn tokens
     * @param _operator The address of the operator (e.g., OFT adapter)
     * @param _status True to enable, false to disable
     * 
     * Only the DAO avatar can call this function.
     */
    function setOperator(address _operator, bool _status) external {
        _onlyAvatar();
        operators[_operator] = _status;
        emit OperatorSet(_operator, _status);
    }

    /**
     * @dev Burn tokens from an address
     * @param _from The address to burn tokens from
     * @param _amount The amount of tokens to burn
     * @return success True if the burn was successful
     * 
     * Only authorized operators (like OFT adapter) or the DAO avatar can call this.
     */
    function burn(address _from, uint256 _amount) external onlyOperators returns (bool) {      
        token.burnFrom(_from, _amount);
        return true;
    }

    /**
     * @dev Mint tokens to an address
     * @param _to The address to mint tokens to
     * @param _amount The amount of tokens to mint
     * @return success True if the mint was successful
     * 
     * Only authorized operators (like OFT adapter) or the DAO avatar can call this.
     */
    function mint(address _to, uint256 _amount) external onlyOperators returns (bool) {       
        return token.mint(_to, _amount);
    }

    /**
     * @dev Pause all mint and burn operations
     * 
     * Only the DAO avatar can call this. Useful for emergency situations.
     */
    function pause() external {
        _onlyAvatar();
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @dev Unpause mint and burn operations
     * 
     * Only the DAO avatar can call this.
     */
    function unpause() external {
        _onlyAvatar();
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

}