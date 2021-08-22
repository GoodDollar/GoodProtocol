// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../staking/compound/GoodCompoundStaking.sol";

contract GoodCompoundStakingTest is GoodCompoundStaking {
	constructor(
		address _token,
		address _iToken,
		INameService _ns,
		string memory _tokenName,
		string memory _tokenSymbol,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		address _compUsdOracle,
		address[] memory _swapPath
	) GoodCompoundStaking() {
		init(
			_token,
			_iToken,
			_ns,
			_tokenName,
			_tokenSymbol,
			_maxRewardThreshold,
			_tokenUsdOracle,
			_compUsdOracle,
			_swapPath
		);
	}

	function redeemUnderlyingToDAITest(uint256 _amount) public {
		redeemUnderlyingToDAI(_amount, address(this));
	}

	function decreaseProductivityTest(address user, uint256 value) public {
		GoodFundManager fm = GoodFundManager(
			nameService.getAddress("FUND_MANAGER")
		);
		(uint32 rewardsPerBlock, uint64 blockStart, uint64 blockEnd, ) = fm
			.rewardsForStakingContract(address(this));
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
