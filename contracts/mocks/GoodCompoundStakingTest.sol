// SPDX-License-Identifier: MIT
pragma solidity >0.5.4;

import "../staking/GoodCompoundStaking.sol";

contract GoodCompoundStakingTest is GoodCompoundStaking {
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
	)
		GoodCompoundStaking(
			_token,
			_iToken,
			_blockInterval,
			_ns,
			_tokenName,
			_tokenSymbol,
			_maxRewardThreshold,
			_tokenUsdOracle,
			_collectInterestGasCost
		)
	{}

	function redeemUnderlyingToDAITest(uint256 _amount) public {
		redeemUnderlyingToDAI(_amount);
	}

	function decreaseProductivityTest(address user, uint256 value) public {
		GoodFundManager fm =
			GoodFundManager(nameService.getAddress("FUND_MANAGER"));
		(uint32 rewardsPerBlock, uint64 blockStart, uint64 blockEnd, ) =
			fm.rewardsForStakingContract(address(this));
		_decreaseProductivity(
			user,
			value,
			rewardsPerBlock,
			blockStart,
			blockEnd
		);
	}

	function mintToken(address user, uint256 value) public {
		_mint(user, value);
	}
}
