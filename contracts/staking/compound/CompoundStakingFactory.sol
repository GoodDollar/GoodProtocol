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

	event Deployed(address proxy, address cToken);

	function clone(cERC20 cToken, bytes32 paramsHash)
		public
		returns (GoodCompoundStaking)
	{
		address deployed =
			address(impl).cloneDeterministic(
				keccak256(abi.encodePacked(address(cToken), paramsHash))
			);
		emit Deployed(deployed, address(cToken));
		return GoodCompoundStaking(deployed);
	}
	/**
	@dev Function to clone Staking contract and initialize new one with new ctoken
	@param cToken Staking cToken to use in staking contract
	@param _ns NameService that holds whole necessary addresses
	@param _maxRewardThreshold Block numbers that need to pass in order to user would get their rewards with 1x multiplier instead of 0.5x
	@param _tokenUsdOracle address of the TOKEN/USD oracle
	@param _compUsdOracle address of the AAVE/USD oracle
	 */
	function cloneAndInit(
		cERC20 cToken,
		INameService _ns,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		address _compUsdOracle
	) public {
		GoodCompoundStaking deployed =
			clone(
				cToken,
				keccak256(
					abi.encodePacked(
						address(_ns),
						_maxRewardThreshold,
						_tokenUsdOracle
					)
				)
			);
		deployed.init(
			cToken.underlying(),
			address(cToken),
			_ns,
			string(abi.encodePacked("GoodCompoundStaking ", cToken.name())),
			string(abi.encodePacked("g", cToken.symbol())),
			_maxRewardThreshold,
			_tokenUsdOracle,
			_compUsdOracle
		);
	}

	function predictAddress(cERC20 cToken, bytes32 paramsHash)
		public
		view
		returns (address)
	{
		return
			address(impl).predictDeterministicAddress(
				keccak256(abi.encodePacked(address(cToken), paramsHash))
			);
	}
}
