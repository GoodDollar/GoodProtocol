// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

import "../Interfaces.sol";

import "../DAOStackInterfaces.sol";
import "../utils/NameService.sol";

import "./GovernanceStakingToken.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Tokens
 * or withdraw their stake in Tokens
 * the contracts buy intrest tokens and can transfer the daily interest to the  DAO
 */
contract GovernanceStaking is GovernanceStakingToken,Initializable{
	

	// Token address
	ERC20 token;
	

	// The total staked Token amount in the contract
	// uint256 public totalStaked = 0;

	uint256 constant DECIMAL1e18 = 10**18;
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
     * @param _iToken Address of the Govarnance token which is reward token
	 * @param _ns The address of the NameService contract
	 * @param _tokenName The name of the staking token
	 * @param _tokenSymbol The symbol of the staking token
	 */
	function initialize(
		address _iToken,
		NameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol
	) public virtual initializer {
		setDAO(_ns);
		token = ERC20(address(avatar.nativeToken()));
        rewardsPerBlock = 7; // 7 Govarnance token per block as reward to distribute 12M token monthly
		_setShareToken(_iToken);
		name = _tokenName;
        symbol = _tokenSymbol;
        
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
			token.transferFrom(msg.sender, address(this), _amount),
			"transferFrom failed, make sure you approved token transfer"
		);

		_mint(msg.sender, _amount); // mint Staking token for staker
		_increaseProductivity(msg.sender, _amount);
		emit Staked(msg.sender, address(token), _amount);
	}

	/**
	 * @dev Withdraws the sender staked Token.
	 */
	function withdrawStake(uint256 _amount) external {
		(uint256 userProductivity, ) = getProductivity(msg.sender);
		require(_amount > 0, "Should withdraw positive amount");
		require(userProductivity >= _amount, "Not enough token staked");
		uint256 tokenWithdraw = _amount;
		uint256 tokenActual = token.balanceOf(address(this));
		if (tokenActual < tokenWithdraw) {
			tokenWithdraw = tokenActual;
		}
		_burn(msg.sender, _amount); // burn their staking tokens
		_decreaseProductivity(msg.sender, _amount);
		_mintRewards(msg.sender);
		require(
			token.transfer(msg.sender, tokenWithdraw),
			"withdraw transfer failed"
		);
		emit StakeWithdraw(
			msg.sender,
			address(token),
			tokenWithdraw,
			token.balanceOf(address(this))
		);
	}
	/**
	 * @dev Staker can withdraw their rewards without withdraw their stake 
	 */
	function withdrawRewards() public {
		
		uint amount = _mintRewards(msg.sender);
		emit RewardsWithdraw(msg.sender,shareToken,amount);

	}

	/** 
	 * @dev Mint rewards of the staker
	 * @param user Receipent address of the rewards
	 * @return Returns amount of the minted rewards 
	 */

	function _mintRewards(address user) internal returns(uint){
		uint256 amount = _calcAndUpdateRewards(user);
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

	

	
}
