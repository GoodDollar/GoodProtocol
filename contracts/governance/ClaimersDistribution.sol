// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../utils/DAOContract.sol";
import "../utils/NameService.sol";
import "../Interfaces.sol";
import "../governance/GReputation.sol";

contract ClaimersDistribution is Initializable, DAOContract {
	uint256 public monthlyReputationDistribution;
	uint256 currentMonth;

	struct MonthData {
		mapping(address => uint256) claims;
		uint256 totalClaims;
		uint256 monthlyDistribution;
	}

	mapping(uint256 => MonthData) public months;
	mapping(address => uint256) public lastMonthDistribution;
	mapping(address => uint256) public lastUpdated;

	function initialize() public initializer {
		monthlyReputationDistribution = 1200000000;
		updateMonth();
	}

	function setMonthlyReputationDistribution(
		uint256 newMonthlyReputationDistribution
	) external {
		_onlyAvatar();
		monthlyReputationDistribution = newMonthlyReputationDistribution;
	}

	function updateMonth() public {
		uint256 month = block.timestamp / 30 days;
		if (month != currentMonth) {
			//update new month
			currentMonth = month;
			months[currentMonth]
				.monthlyDistribution = monthlyReputationDistribution;
		}
	}

	function updateClaim(address _claimer) external {
		IUBIScheme ubi = IUBIScheme(nameService.getAddress("UBISCheme"));
		require(
			ubi.hasClaimed(_claimer),
			"ClaimersDistribution: didn't claim today"
		);
		require(
			ubi.currentDay() * 1 days + ubi.periodStart() >
				lastUpdated[_claimer],
			"ClaimersDistribution: already updated"
		);
		updateMonth();

		lastUpdated[_claimer] = block.timestamp;
		months[currentMonth].claims[_claimer] += 1;
		months[currentMonth].totalClaims += 1;

		claimDistribution(_claimer);
	}

	function claimDistribution(address _claimer) public {
		uint256 prevMonth = currentMonth - 1;
		if (lastMonthDistribution[_claimer] >= prevMonth) return;

		if (months[prevMonth].monthlyDistribution > 0) {
			lastMonthDistribution[_claimer] = prevMonth;
			uint256 userShare =
				(months[prevMonth].monthlyDistribution *
					months[prevMonth].claims[_claimer]) /
					months[prevMonth].totalClaims;
			if (userShare > 0) {
				GReputation grep =
					GReputation(nameService.getAddress("GReputation"));
				grep.mint(_claimer, userShare);
			}
		}
	}
}
