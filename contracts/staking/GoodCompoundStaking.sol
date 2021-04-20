// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0;
import "./SimpleStaking.sol";
import "../Interfaces.sol";


/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit DAI/ETH
 * or withdraw their stake in DAI
 * the contracts buy cDai and can transfer the daily interest to the  DAO
 */
contract GoodCompoundStaking is SimpleStaking {




    constructor(
        address _token,
        address _iToken,
        uint256 _blockInterval,
        NameService _ns
    ) public SimpleStaking(_token, _iToken, _blockInterval, _ns) {
        
    }

    /**
     * @dev stake some DAI
     * @param _amount of dai to stake
     */
    function mint(uint256 _amount) internal override{
        
        cERC20 cToken = cERC20(address(iToken));
        uint res = cToken.mint(_amount);

        if (
            res > 0
        ) //cDAI returns >0 if error happened while minting. make sure no errors, if error return DAI funds
        {
            require(res == 0, "Minting cDai failed, funds returned");
        }

    }

    /**
     * @dev redeem DAI from compound 
     * @param _amount of dai to redeem
     */
    function redeem(uint256 _amount) internal override{
        cERC20 cToken = cERC20(address(iToken));
        require(cToken.redeemUnderlying(_amount) == 0, "Failed to redeem cDai");

    }

    /**
     * @dev returns Dai to cDai Exchange rate.
     */
    function exchangeRate() internal view override returns(uint) {
        cERC20 cToken = cERC20(address(iToken));
        return cToken.exchangeRateStored();

    }

    /**
     * @dev returns decimals of token.
     */
    function tokenDecimal() internal view override returns(uint) {
        ERC20 token = ERC20(address(token));
        return uint(token.decimals());
    }

    /**
     * @dev returns decimals of interest token.
     */
    function iTokenDecimal() internal view override returns(uint) {
        ERC20 cToken = ERC20(address(iToken));
        return uint(cToken.decimals());
    }
}