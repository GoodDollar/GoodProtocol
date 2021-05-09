// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "../Interfaces.sol";

import "../DAOStackInterfaces.sol";
import "../utils/NameService.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "./BaseGovernanceShareField.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Tokens
 * or withdraw their stake in Tokens
 * the contracts buy intrest tokens and can transfer the daily interest to the  DAO
 */
contract GovernanceStaking is ERC20Upgradeable,BaseGovernanceShareField{
	

	// Token address
	ERC20 token;
	

	// The total staked Token amount in the contract
	// uint256 public totalStaked = 0;

    /**
     * @dev Emitted when `staker` stake `value` tokens of `token`
     */
    event Staked(address indexed staker, address token, uint256 value);

    /**
     * @dev Emitted when `staker` withdraws their stake `value` tokens and contracts balance will 
     * be reduced to`remainingBalance`.
     */
    event StakeWithdraw(address indexed staker, address token, uint256 value, uint256 remainingBalance);

	/**
	 * @dev Emitted when `staker` withdraws their rewards `value` tokens 
 	 */
	event RewardsWithdraw(address indexed staker,address token,uint256 value);
	/**
	 * @dev Constructor
	 * @param _ns The address of the NameService contract
	 * @param _tokenName The name of the staking token
	 * @param _tokenSymbol The symbol of the staking token
	 * @param _monthlyRewards Amount of the total rewards will be distributed over month
	 */
	function initialize(
		NameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint256 _monthlyRewards
	) public virtual initializer {
		setDAO(_ns);
		token = ERC20(nameService.addresses(nameService.GOODDOLLAR()));
		_setShareToken(nameService.addresses(nameService.REPUTATION()));
		__ERC20_init(_tokenName,_tokenSymbol);
		rewardsPerBlock = _monthlyRewards / 172800;
        
	}

	/**
	 * @dev Allows a staker to deposit Tokens. Notice that `approve` is
	 * needed to be executed before the execution of this method.
	 * Can be executed only when the contract is not paused.
	 * @param _amount The amount of DAI to stake
	 */
	function stake(uint256 _amount)
		external
	{
		require(_amount > 0, "You need to stake a positive token amount");
		require(
			token.transferFrom(_msgSender(), address(this), _amount),
			"transferFrom failed, make sure you approved token transfer"
		);
		_increaseProductivity(_msgSender(), _amount);
		_mint(_msgSender(), _amount); // mint Staking token for staker
		
		emit Staked(_msgSender(), address(token), _amount);
	}

	/**
	 * @dev Withdraws the sender staked Token.
	 */
	function withdrawStake(uint256 _amount) external {
		(uint256 userProductivity, ) = getProductivity(_msgSender());
		require(_amount > 0, "Should withdraw positive amount");
		require(userProductivity >= _amount, "Not enough token staked");
		uint256 tokenWithdraw = _amount;
		uint256 tokenActual = token.balanceOf(address(this));
		if (tokenActual < tokenWithdraw) {
			tokenWithdraw = tokenActual;
		}
		_burn(_msgSender(), _amount); // burn their staking tokens
		_decreaseProductivity(_msgSender(), _amount);
		_mintRewards(_msgSender());
		require(
			token.transfer(_msgSender(), tokenWithdraw),
			"withdraw transfer failed"
		);
		emit StakeWithdraw(
			_msgSender(),
			address(token),
			tokenWithdraw,
			token.balanceOf(address(this))
		);
	}
	/**
	 * @dev Staker can withdraw their rewards without withdraw their stake 
	 */
	function withdrawRewards() public {
		
		uint amount = _mintRewards(_msgSender());
		emit RewardsWithdraw(_msgSender(),shareToken,amount);

	}

	/** 
	 * @dev Mint rewards of the staker
	 * @param user Receipent address of the rewards
	 * @return Returns amount of the minted rewards 
	 */

	function _mintRewards(address user) internal returns(uint){
		uint256 amount = _issueEarnedRewards(user);
		ERC20(shareToken).mint(user,amount);
		return amount;
	}
	function getStakerData(address _staker)
		public
		view
		returns (
			uint256,
			uint256,
			uint256
		)
	{
		return (
			users[_staker].amount,
			users[_staker].rewardDebt,
			users[_staker].rewardEarn
			);
	}

	/**
     * @dev Returns the number of decimals used to get its user representation.
	 */
	function decimals() public view virtual override returns (uint8) {
        return 2;
    }

	/**
	 * @dev Override transfer function of ERC20
	 */
	function transfer(address to, uint value) public virtual override returns  (bool) {
		_decreaseProductivity(_msgSender(), value);
        _increaseProductivity(to, value);
		_transfer(_msgSender(), to, value);
		return true;
	}

	/**
	 * @dev Override transferFrom function of ERC20
	 */
	 function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        _decreaseProductivity(sender, amount);
        _increaseProductivity(recipient, amount);
		_transfer(sender, recipient, amount);

        uint256 currentAllowance = allowance(sender,_msgSender());
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        _approve(sender, _msgSender(), currentAllowance - amount);

        return true;
    }

	
}
