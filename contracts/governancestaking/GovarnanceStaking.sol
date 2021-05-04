// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;


import "../Interfaces.sol";

import "../DAOStackInterfaces.sol";
import "../utils/NameService.sol";
import "../utils/Pausable.sol";
import "../utils/DAOContract.sol";
import "./GovernanceStakingToken.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Tokens
 * or withdraw their stake in Tokens
 * the contracts buy intrest tokens and can transfer the daily interest to the  DAO
 */
contract GovernanceStaking is Pausable, GovernanceStakingToken {
	

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
	 * @dev Constructor
     * @param _iToken Address of the Govarnance token which is reward token
	 * @param _ns The address of the NameService contract
	 * @param _tokenName The name of the staking token
	 * @param _tokenSymbol The symbol of the staking token
	 */
	constructor(
		address _iToken,
		NameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol
	) GovernanceStakingToken(_tokenName, _tokenSymbol) {
		setDAO(_ns);
		token = ERC20(address(avatar.nativeToken()));
        rewardsPerBlock = 7; // 7 Govarnance token per block as reward to distribute 12M token monthly
		_setShareToken(_iToken);
		// Adds the avatar as a pauser of this contract
		addPauser(address(avatar));
        
	}

	/**
	 * @dev Allows a staker to deposit Tokens. Notice that `approve` is
	 * needed to be executed before the execution of this method.
	 * Can be executed only when the contract is not paused.
	 * @param _amount The amount of DAI to stake
	 */
	function stake(uint256 _amount)
		external
		whenNotPaused
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

	function withdrawRewards() public {
		
		_mintRewards(msg.sender);

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
	 * @dev making the contract inactive
	 * NOTICE: this could theoretically result in future interest earned in cdai to remain locked
	 * but we dont expect any other stakers but us in SimpleDAIStaking
	 */
	function end() public {
		_onlyAvatar();
		pause();
	}

	/**
	 * @dev method to recover any stuck erc20 tokens (ie  compound COMP)
	 * @param _token the ERC20 token to recover
	 */
	function recover(ERC20 _token) public {
		_onlyAvatar();
		uint256 toWithdraw = _token.balanceOf(address(this));

		// recover left iToken(stakers token) only when all stakes have been withdrawn
		if (address(_token) == address(token)) {
			require(
				totalProductivity == 0 && paused(),
				"can recover token only when stakes have been withdrawn"
			);
		}
		require(
			_token.transfer(address(avatar), toWithdraw),
			"recover transfer failed"
		);
	}
}
