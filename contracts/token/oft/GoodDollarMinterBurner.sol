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
 * - Weekly and monthly mint/burn limits (configurable by DAO, 0 to disable)
 * - Automatic period reset when limits are checked
 * - Pause functionality for emergency situations
 * - Upgradeable via DAO governance
 */
contract GoodDollarMinterBurner is DAOUpgradeableContract {
    ISuperGoodDollar public token;
    mapping(address => bool) public operators;
    
    bool public paused;
    
    // Weekly and monthly limits
    uint256 public weeklyMintLimit;
    uint256 public monthlyMintLimit;
    uint256 public weeklyBurnLimit;
    uint256 public monthlyBurnLimit;
    
    // Current period tracking
    uint256 public weeklyMinted;
    uint256 public monthlyMinted;
    uint256 public weeklyBurned;
    uint256 public monthlyBurned;
    
    // Period start timestamps
    uint256 public currentWeekStart;
    uint256 public currentMonthStart;
    
    // Constants for period duration
    uint256 public constant WEEK_DURATION = 7 days;
    uint256 public constant MONTH_DURATION = 30 days;

    event OperatorSet(address indexed operator, bool status);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event WeeklyMintLimitSet(uint256 oldLimit, uint256 newLimit);
    event MonthlyMintLimitSet(uint256 oldLimit, uint256 newLimit);
    event WeeklyBurnLimitSet(uint256 oldLimit, uint256 newLimit);
    event MonthlyBurnLimitSet(uint256 oldLimit, uint256 newLimit);
    
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
        currentWeekStart = block.timestamp;
        currentMonthStart = block.timestamp;
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
     * @dev Set the weekly mint limit
     * @param _limit The new weekly mint limit (0 to disable)
     * 
     * Only the DAO avatar can call this function.
     */
    function setWeeklyMintLimit(uint256 _limit) external {
        _onlyAvatar();
        uint256 oldLimit = weeklyMintLimit;
        weeklyMintLimit = _limit;
        emit WeeklyMintLimitSet(oldLimit, _limit);
    }

    /**
     * @dev Set the monthly mint limit
     * @param _limit The new monthly mint limit (0 to disable)
     * 
     * Only the DAO avatar can call this function.
     */
    function setMonthlyMintLimit(uint256 _limit) external {
        _onlyAvatar();
        uint256 oldLimit = monthlyMintLimit;
        monthlyMintLimit = _limit;
        emit MonthlyMintLimitSet(oldLimit, _limit);
    }

    /**
     * @dev Set the weekly burn limit
     * @param _limit The new weekly burn limit (0 to disable)
     * 
     * Only the DAO avatar can call this function.
     */
    function setWeeklyBurnLimit(uint256 _limit) external {
        _onlyAvatar();
        uint256 oldLimit = weeklyBurnLimit;
        weeklyBurnLimit = _limit;
        emit WeeklyBurnLimitSet(oldLimit, _limit);
    }

    /**
     * @dev Set the monthly burn limit
     * @param _limit The new monthly burn limit (0 to disable)
     * 
     * Only the DAO avatar can call this function.
     */
    function setMonthlyBurnLimit(uint256 _limit) external {
        _onlyAvatar();
        uint256 oldLimit = monthlyBurnLimit;
        monthlyBurnLimit = _limit;
        emit MonthlyBurnLimitSet(oldLimit, _limit);
    }

    /**
     * @dev Internal function to reset weekly period if needed
     */
    function _resetWeeklyIfNeeded() internal {
        if (block.timestamp >= currentWeekStart + WEEK_DURATION) {
            weeklyMinted = 0;
            weeklyBurned = 0;
            currentWeekStart = block.timestamp;
        }
    }

    /**
     * @dev Internal function to reset monthly period if needed
     */
    function _resetMonthlyIfNeeded() internal {
        if (block.timestamp >= currentMonthStart + MONTH_DURATION) {
            monthlyMinted = 0;
            monthlyBurned = 0;
            currentMonthStart = block.timestamp;
        }
    }

    /**
     * @dev Burn tokens from an address
     * @param _from The address to burn tokens from
     * @param _amount The amount of tokens to burn
     * @return success True if the burn was successful
     * 
     * Only authorized operators (like OFT adapter) or the DAO avatar can call this.
     * Enforces weekly and monthly burn limits if set.
     */
    function burn(address _from, uint256 _amount) external onlyOperators returns (bool) {
        // Reset periods if needed
        _resetWeeklyIfNeeded();
        _resetMonthlyIfNeeded();
        
        // Check weekly limit (0 means no limit)
        if (weeklyBurnLimit > 0) {
            require(weeklyBurned + _amount <= weeklyBurnLimit, "Weekly burn limit exceeded");
        }
        
        // Check monthly limit (0 means no limit)
        if (monthlyBurnLimit > 0) {
            require(monthlyBurned + _amount <= monthlyBurnLimit, "Monthly burn limit exceeded");
        }
        
        // Update counters
        weeklyBurned += _amount;
        monthlyBurned += _amount;
        
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
     * Enforces weekly and monthly mint limits if set.
     */
    function mint(address _to, uint256 _amount) external onlyOperators returns (bool) {
        // Reset periods if needed
        _resetWeeklyIfNeeded();
        _resetMonthlyIfNeeded();
        
        // Check weekly limit (0 means no limit)
        if (weeklyMintLimit > 0) {
            require(weeklyMinted + _amount <= weeklyMintLimit, "Weekly mint limit exceeded");
        }
        
        // Check monthly limit (0 means no limit)
        if (monthlyMintLimit > 0) {
            require(monthlyMinted + _amount <= monthlyMintLimit, "Monthly mint limit exceeded");
        }
        
        // Update counters
        weeklyMinted += _amount;
        monthlyMinted += _amount;
        
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