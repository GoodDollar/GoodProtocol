// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;

/**
 * @title Abstract contract that holds all the data, 
 * events and functions for staking contract.
 * The staking contract will inherit this interface
 */
contract AbstractGoodStaking {

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
     * @dev Emitted when fundmanager transfers intrest collected from defi protrocol.
     * `recipient` will receive `intrestTokenValue` as intrest.
     */
    event InterestCollected(
        address recipient,
        address token,
        address intrestToken,
        uint256 intrestTokenValue,
        uint256 tokenValue,
        uint256 tokenPrecisionLoss
    );

    /**
     * @dev stake some tokens
     * @param _amount of Tokens to stake
     */
    function stake(uint256 _amount, uint256 _donationPer) virtual external {
        
    }

    /**
     * @dev withdraw staked tokens
     */
    function withdrawStake(uint256 _amount) virtual external {
        
    }

    /**
     * @dev calculates the holding of intrestToken by staking contract in terms of token value.
     * @return It will return the token worth of intrest token that contract is holding.
     */
    function currentTokenWorth() external view virtual returns (uint256) {

    }

    /**
     * @dev calculates the tokenGain, intrestTokenGain and precisionLossToken
     * @return Intrest gained on lending the tokens.
     * @return Intrest gained on lending the tokens in terms of token rate.
     * @return Token's precision loss due to decimal difference.
     */
    function currentUBIInterest()
        external
        virtual
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
    
    }

    /**
     * @dev collect gained interest by fundmanager
     * @param recipient of intrestToken gains
     * @return Intrest gained on lending the tokens.
     * @return Intrest gained on lending the tokens in terms of token rate.
     * @return Token's precision loss due to decimal difference.
     * @return average intrest donation ratio.
     */
    function collectUBIInterest(address recipient)
        external
        virtual
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        
    }
    /**
     * @dev Get gas cost for interest transfer so can be used in the calculation of collectable interest for particular gas amount
     * @return returns hardcoded gas cost
     */
    function getGasCostForInterestTransfer() external view virtual returns(uint256){}
    /**
     * @dev Get Token price in USD
     * @param _amount Amount of token to get worth of it in USD
     * @return Returns Worth of Token in USD
     */
    function getTokenPriceInUSD(uint _amount) internal view virtual returns(uint256){}
    /**
     * @dev Invests staked tokens to defi protocol.
     * @param amount tokens staked.
     */
    function mintInterestToken(uint amount) internal virtual{}

    /**
     * @dev Redeem invested tokens from defi protocol.
     * @param amount tokens to be redeemed.
     */
    function redeem(uint amount) internal virtual{}
    /**
     * @dev Redeem invested underlying tokens from defi protocol
     * @dev amount tokens to be redeemed
     * @return token which redeemed from protocol and redeemed amount
     */
     function redeemUnderlying(uint _amount) internal virtual returns(address, uint){}
    /**
     * @dev Calculates exchange rate for token to intrest token from defi protocol.
     * @return exchange rate.
     */
    function exchangeRate() internal view virtual returns(uint) {}
    /**
     * @dev Returns decimal value for token.
     */
    function tokenDecimal() internal view virtual returns(uint) {}

    /**
     * @dev Returns decimal value for intrest token.
     */
    function iTokenDecimal() internal view virtual returns(uint) {}
}