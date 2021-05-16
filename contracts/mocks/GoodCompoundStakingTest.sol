pragma solidity >0.5.4;

import "../staking/GoodCompoundStaking.sol";




contract GoodCompoundStakingTest is GoodCompoundStaking{

    constructor(
		address _token,
		address _iToken,
		uint256 _blockInterval,
		NameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		uint32 _collectInterestGasCost
	) GoodCompoundStaking(_token,_iToken,_blockInterval,_ns,_tokenName,_tokenSymbol,_maxRewardThreshold,_tokenUsdOracle,_collectInterestGasCost){

    }
    

    function redeemUnderlyingToDAITest(uint256 _amount) public {
        redeemUnderlyingToDAI(_amount);

    }
}