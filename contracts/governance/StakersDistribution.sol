// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../utils/DAOContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../governance/GReputation.sol";
import "../governance/MultiBaseGovernanceShareField.sol";
import "../staking/GoodFundManager.sol";
import "../staking/SimpleStaking.sol";

/**
 * Staking contracts will update this contract with staker token stake amount
 * This contract will be able to mint GDAO based on initial 2M that will be allocated between staking contracts
 * each staker will receive his share pro rata per staking contract he participates in
 */
contract StakersDistribution is
	Initializable,
	DAOContract,
	MultiBaseGovernanceShareField
{
	///@notice reputation to distribute each month, will effect next month when set
	uint256 public monthlyReputationDistribution;

	///@notice month number since epoch
	uint256 public currentMonth;

	function initialize(NameService _ns) public initializer {
		monthlyReputationDistribution = 2000000 ether; //2M as specified in specs
		setDAO(_ns);
		_updateMonth();
	}

	function getChainBlocksPerMonth() public pure override returns (uint256) {
		return 5760;
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
	function _updateMonth() internal {
		uint256 month = block.timestamp / 30 days;
		if (month != currentMonth) {
			//read active staking contracts set pro rate monthly share
			GoodFundManager gfm =
				GoodFundManager(
					nameService.addresses(nameService.FUND_MANAGER())
				);

			uint256 activeContractsCount = gfm.getActiveContractsCount();
			address payable[] memory activeStakingList =
				new address payable[](activeContractsCount);
			uint256[] memory contractLockedValue =
				new uint256[](activeContractsCount);

			uint256 totalLockedValue;
			for (uint256 i = 0; i < activeContractsCount; i++) {
				activeStakingList[i] = payable(gfm.activeContracts(i));
				(, uint64 blockStart, uint64 blockEnd, ) =
					gfm.rewardsForStakingContract(activeStakingList[i]);
				if (blockStart <= block.number && blockEnd > block.number) {
					contractLockedValue[i] = SimpleStaking(activeStakingList[i])
						.getTokenValueInUSD(
						SimpleStaking(activeStakingList[i]).currentTokenWorth()
					);
					totalLockedValue += contractLockedValue[i];
				}
			}

			//set each contract relative monthly rewards
			for (uint256 i = 0; i < activeContractsCount; i++) {
				if (contractLockedValue[i] > 0) {
					_setMonthlyRewards(
						activeStakingList[i],
						(monthlyReputationDistribution *
							contractLockedValue[i]) / totalLockedValue
					);
				}
			}

			//update new month
			currentMonth = month;
		}
	}

	/**
	 * @dev staking contract can call this to increase user current contribution
	 * @param _staker the user to update
	 * @param _value the value to increase by
	 */
	function userStaked(address _staker, uint256 _value) external {
		(, uint64 blockStart, uint64 blockEnd, bool isBlackListed) =
			GoodFundManager(nameService.addresses(nameService.FUND_MANAGER()))
				.rewardsForStakingContract(msg.sender);

		if (isBlackListed) return; //dont do anything if staking contract has been blacklisted;

		_increaseProductivity(
			msg.sender,
			_staker,
			_value,
			blockStart,
			blockEnd
		);

		address[] memory contracts = new address[](1);
		contracts[0] = (address(this));
		_claimReputation(_staker, contracts);

		_updateMonth(); //previous calls will use previous month reputation
	}

	/**
	 * @dev staking contract can call this to decrease user current contribution
	 * @param _staker the user to update
	 * @param _value the value to decrease by
	 */
	function userWithdraw(address _staker, uint256 _value) external {
		(, uint64 blockStart, uint64 blockEnd, bool isBlackListed) =
			GoodFundManager(nameService.addresses(nameService.FUND_MANAGER()))
				.rewardsForStakingContract(msg.sender);

		if (isBlackListed) return; //dont do anything if staking contract has been blacklisted;

		_decreaseProductivity(
			msg.sender,
			_staker,
			_value,
			blockStart,
			blockEnd
		);

		address[] memory contracts = new address[](1);
		contracts[0] = (msg.sender);
		_claimReputation(_staker, contracts);
		_updateMonth(); //previous calls will use previous month reputation
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
		_updateMonth(); //previous calls will use previous month reputation
	}

	function _claimReputation(
		address _staker,
		address[] memory _stakingContracts
	) internal {
		uint256 totalRep;
		GoodFundManager gfm =
			GoodFundManager(nameService.addresses(nameService.FUND_MANAGER()));

		for (uint256 i = 0; i < _stakingContracts.length; i++) {
			(, uint64 blockStart, uint64 blockEnd, bool isBlackListed) =
				gfm.rewardsForStakingContract(_stakingContracts[i]);

			if (isBlackListed == false)
				totalRep += _issueEarnedRewards(
					_stakingContracts[i],
					_staker,
					blockStart,
					blockEnd
				);
		}
		if (totalRep > 0)
			GReputation(nameService.addresses(nameService.REPUTATION())).mint(
				_staker,
				totalRep
			);
	}

	function getUserPendingRewards(address[] calldata _contracts, address _user)
		external
		view
		returns (uint256)
	{
		uint256 pending;
		for (uint256 i = 0; i < _contracts.length; i++) {
			(, uint64 blockStart, uint64 blockEnd, bool isBlackListed) =
				GoodFundManager(
					nameService.addresses(nameService.FUND_MANAGER())
				)
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
}
