// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "./GoodAaveStaking.sol";
import "../../Interfaces.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Token
 * or withdraw their stake in Token
 * the contracts buy cToken and can transfer the daily interest to the  DAO
 */
contract AaveStakingFactory {
	using ClonesUpgradeable for address;

	address impl = address(new GoodAaveStaking());

	event Deployed(address proxy, address token);

	function clone(ERC20 token, bytes32 paramsHash)
		public
		returns (GoodAaveStaking)
	{
		address deployed = address(impl).cloneDeterministic(
			keccak256(abi.encodePacked(address(token), paramsHash))
		);
		emit Deployed(deployed, address(token));
		return GoodAaveStaking(deployed);
	}

	/**
	@dev Function to clone Staking contract and initialize new one with new token
	@param token Staking token to use in staking contract
	@param _lendingPool address of the lending Pool of AAVE Protocol
	@param _ns NameService that holds whole necessary addresses
	@param _maxRewardThreshold Block numbers that need to pass in order to user would get their rewards with 1x multiplier instead of 0.5x
	@param _tokenUsdOracle address of the TOKEN/USD oracle
	@param _incentiveController Incentive Controller of AAVE protocol in order to claim rewards from AAVE
	@param _aaveUSDOracle address of the AAVE/USD oracle
	 */
	function cloneAndInit(
		ERC20 token,
		address _lendingPool,
		INameService _ns,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		IAaveIncentivesController _incentiveController,
		address _aaveUSDOracle,
		address[] memory _tokenToDaiSwapPath
	) public {
		GoodAaveStaking deployed = clone(
			token,
			keccak256(
				abi.encodePacked(
					address(_lendingPool),
					address(_ns),
					_maxRewardThreshold,
					_tokenUsdOracle,
					address(_incentiveController),
					_aaveUSDOracle
				)
			)
		);

		deployed.init(
			address(token),
			address(_lendingPool),
			_ns,
			string(abi.encodePacked("GoodAaveStaking ", token.name())),
			string(abi.encodePacked("g", token.symbol())),
			_maxRewardThreshold,
			_tokenUsdOracle,
			_incentiveController,
			_aaveUSDOracle,
			_tokenToDaiSwapPath
		);
	}

	function predictAddress(ERC20 token, bytes32 paramsHash)
		public
		view
		returns (address)
	{
		return
			address(impl).predictDeterministicAddress(
				keccak256(abi.encodePacked(address(token), paramsHash))
			);
	}
}
