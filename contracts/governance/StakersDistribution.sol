// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "../utils/DAOContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../governance/GReputation.sol";
import "../governance/MultiBaseGovernanceShareField.sol";
import "../staking/GoodFundManager.sol";
import "../staking/SimpleStakingV2.sol";

/**
 * Staking contracts will update this contract with staker token stake amount
 * This contract will be able to mint GDAO. 2M GDAO that will be allocated between staking contracts each month pro-rate based on $ value staked.
 * Each staker will receive his share pro rata per staking contract he participates in
 * NOTICE: a contract will start earning GDAO rewards only after first month
 */
contract StakersDistribution is
	DAOUpgradeableContract,
	MultiBaseGovernanceShareField
{
	///@notice reputation to distribute each month, will effect next month when set
	uint256 public monthlyReputationDistribution;

	///@notice month number since epoch
	uint256 public currentMonth;

	event ReputationEarned(
		address staker,
		address[] stakingContracts,
		uint256 reputation
	);

	function initialize(INameService _ns) public initializer {
		monthlyReputationDistribution = 2000000 ether; //2M as specified in specs
		setDAO(_ns);
	}

	/**
	 * @dev this contract runs on ethereum
	 */
	function getChainBlocksPerMonth() public pure override returns (uint256) {
		return 172800; //4 * 60 * 24 * 30
	}

	/**
	 * @dev update the monthly reputation distribution. only avatar can do that.
	 * @param newMonthlyReputationDistribution the new reputation amount to distribute
	 */
	function setMonthlyReputationDistribution(
		uint256 newMonthlyReputationDistribution
	) external {
		_onlyAvatar();
		monthlyReputationDistribution = newMonthlyReputationDistribution;
	}

	/**
	 * @dev internal function to switch to new month. records for new month the current monthlyReputationDistribution
	 */
	function _updateRewards() internal {
		if (nameService.getAddress("FUND_MANAGER") != address(0)) {
			//read active staking contracts set pro rate monthly share
			GoodFundManager gfm = GoodFundManager(
				nameService.getAddress("FUND_MANAGER")
			);

			uint256 activeContractsCount = gfm.getActiveContractsCount();
			address payable[] memory activeStakingList = new address payable[](
				activeContractsCount
			);
			uint256[] memory contractLockedValue = new uint256[](
				activeContractsCount
			);

			uint256 totalLockedValue;
			for (uint256 i = 0; i < activeContractsCount; i++) {
				activeStakingList[i] = payable(gfm.activeContracts(i));
				(, uint64 blockStart, uint64 blockEnd, ) = gfm
					.rewardsForStakingContract(activeStakingList[i]);
				if (blockStart <= block.number && blockEnd > block.number) {
					uint256 lockedValueInUSD = SimpleStakingV2(activeStakingList[i])
						.lockedUSDValue();
					contractLockedValue[i] = lockedValueInUSD;
					totalLockedValue += contractLockedValue[i];
				}
			}

			//set each contract relative monthly rewards
			for (uint256 i = 0; i < activeContractsCount; i++) {
				uint256 contractShare = totalLockedValue > 0
					? (monthlyReputationDistribution * contractLockedValue[i]) /
						totalLockedValue
					: monthlyReputationDistribution / activeContractsCount;
				if (contractLockedValue[i] > 0) {
					_setMonthlyRewards(activeStakingList[i], contractShare);
				}
			}
		}
	}

	/**
	 * @dev staking contract can call this to increase user current contribution
	 * @param _staker the user to update
	 * @param _value the value to increase by
	 */
	function userStaked(address _staker, uint256 _value) external {
		address stakingContract = msg.sender;
		(
			,
			uint64 blockStart,
			uint64 blockEnd,
			bool isBlackListed
		) = GoodFundManager(nameService.getAddress("FUND_MANAGER"))
				.rewardsForStakingContract(stakingContract);

		if (isBlackListed) return; //dont do anything if staking contract has been blacklisted;

		_increaseProductivity(
			stakingContract,
			_staker,
			_value,
			blockStart,
			blockEnd
		);

		address[] memory contracts = new address[](1);
		contracts[0] = stakingContract;

		_claimReputation(_staker, contracts);

		_updateRewards();
	}

	/**
	 * @dev staking contract can call this to decrease user current contribution
	 * @param _staker the user to update
	 * @param _value the value to decrease by
	 */
	function userWithdraw(address _staker, uint256 _value) external {
		address stakingContract = msg.sender;
		(
			,
			uint64 blockStart,
			uint64 blockEnd,
			bool isBlackListed
		) = GoodFundManager(nameService.getAddress("FUND_MANAGER"))
				.rewardsForStakingContract(stakingContract);

		if (isBlackListed) return; //dont do anything if staking contract has been blacklisted;

		_decreaseProductivity(
			stakingContract,
			_staker,
			_value,
			blockStart,
			blockEnd
		);

		address[] memory contracts = new address[](1);
		contracts[0] = stakingContract;
		_claimReputation(_staker, contracts);
		_updateRewards();
	}

	/**
	 * @dev mints reputation to user according to his share in the different staking contracts
	 * @param _staker the user to distribute reputation to
	 * @param _stakingContracts the user to distribute reputation to
	 */
	function claimReputation(
		address _staker,
		address[] calldata _stakingContracts
	) external {
		_claimReputation(_staker, _stakingContracts);
	}

	function _claimReputation(address _staker, address[] memory _stakingContracts)
		internal
	{
		uint256 totalRep;
		GoodFundManager gfm = GoodFundManager(
			nameService.getAddress("FUND_MANAGER")
		);

		for (uint256 i = 0; i < _stakingContracts.length; i++) {
			(, uint64 blockStart, uint64 blockEnd, bool isBlackListed) = gfm
				.rewardsForStakingContract(_stakingContracts[i]);

			if (isBlackListed == false)
				totalRep += _issueEarnedRewards(
					_stakingContracts[i],
					_staker,
					blockStart,
					blockEnd
				);
		}
		if (totalRep > 0) {
			GReputation(nameService.getAddress("REPUTATION")).mint(_staker, totalRep);
			emit ReputationEarned(_staker, _stakingContracts, totalRep);
		}
	}

	/**
	 * @dev get user reputation rewards accrued in goodstaking contracts
	 * @param _contracts list of contracts to check for rewards
	 * @param _user the user to check rewards for
	 * @return reputation rewards pending for user
	 */
	function getUserPendingRewards(address[] memory _contracts, address _user)
		public
		view
		returns (uint256)
	{
		uint256 pending;
		for (uint256 i = 0; i < _contracts.length; i++) {
			(
				,
				uint64 blockStart,
				uint64 blockEnd,
				bool isBlackListed
			) = GoodFundManager(nameService.getAddress("FUND_MANAGER"))
					.rewardsForStakingContract(_contracts[i]);

			if (isBlackListed == false) {
				pending += getUserPendingReward(
					_contracts[i],
					blockStart,
					blockEnd,
					_user
				);
			}
		}

		return pending;
	}

	/**
	 * @param _contracts staking contracts to sum _user minted and pending
	 * @param _user account to get rewards status for
	 * @return (minted, pending) in GDAO 18 decimals
	 */
	function getUserMintedAndPending(address[] memory _contracts, address _user)
		public
		view
		returns (uint256, uint256)
	{
		uint256 pending = getUserPendingRewards(_contracts, _user);
		uint256 minted;
		for (uint256 i = 0; i < _contracts.length; i++) {
			minted += contractToUsers[_contracts[i]][_user].rewardMinted;
		}
		return (minted, pending);
	}
}
