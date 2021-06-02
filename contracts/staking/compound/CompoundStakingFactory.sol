// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "./GoodCompoundStaking.sol";
import "../../Interfaces.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Token
 * or withdraw their stake in Token
 * the contracts buy cToken and can transfer the daily interest to the  DAO
 */
contract CompoundStakingFactory {
	using ClonesUpgradeable for address;

	address impl = address(new GoodCompoundStaking());

	event Deployed(address deployed, address cToken);

	function clone(cERC20 cToken) public returns (GoodCompoundStaking) {
		address deployed =
			address(cToken).cloneDeterministic(
				keccak256(abi.encodePacked(cToken.name(), cToken.symbol()))
			);
		emit Deployed(deployed, address(cToken));
		return GoodCompoundStaking(deployed);
	}

	function cloneAndInit(
		cERC20 cToken,
		NameService _ns,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		uint32 _collectInterestGasCost
	) public {
		GoodCompoundStaking deployed = clone(cToken);
		deployed.init(
			cToken.underlying(),
			address(cToken),
			_ns,
			string(abi.encodePacked("GoodCompoundStaking ", cToken.name())),
			string(abi.encodePacked("g", cToken.symbol())),
			_maxRewardThreshold,
			_tokenUsdOracle,
			_collectInterestGasCost
		);
	}
}
