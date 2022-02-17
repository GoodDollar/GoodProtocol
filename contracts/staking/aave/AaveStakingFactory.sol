// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "./GoodAaveStakingV2.sol";
import "../../Interfaces.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Token
 * or withdraw their stake in Token
 * the contracts buy cToken and can transfer the daily interest to the  DAO
 */
contract AaveStakingFactory {
	using ClonesUpgradeable for address;

	address public impl = address(new GoodAaveStakingV2());

	event Deployed(address proxy, address token, address impl);

	function clone(
		address _impl,
		ERC20 token,
		bytes32 paramsHash
	) internal returns (GoodAaveStakingV2) {
		address deployed = address(_impl).cloneDeterministic(
			keccak256(abi.encodePacked(address(token), paramsHash))
		);
		emit Deployed(deployed, address(token), _impl);
		return GoodAaveStakingV2(deployed);
	}

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
		cloneAndInit(
			impl,
			token,
			_lendingPool,
			_ns,
			_maxRewardThreshold,
			_tokenUsdOracle,
			_incentiveController,
			_aaveUSDOracle,
			_tokenToDaiSwapPath
		);
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
		address _impl,
		ERC20 token,
		address _lendingPool,
		INameService _ns,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		IAaveIncentivesController _incentiveController,
		address _aaveUSDOracle,
		address[] memory _tokenToDaiSwapPath
	) public {
		GoodAaveStakingV2 deployed = clone(
			_impl,
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
			string(abi.encodePacked("GoodAaveStakingV2 ", token.name())),
			string(abi.encodePacked("ga", token.symbol())),
			_maxRewardThreshold,
			_tokenUsdOracle,
			_incentiveController,
			_aaveUSDOracle,
			_tokenToDaiSwapPath
		);
	}

	function predictAddress(
		address _impl,
		ERC20 token,
		bytes32 paramsHash
	) public view returns (address) {
		return
			address(_impl).predictDeterministicAddress(
				keccak256(abi.encodePacked(address(token), paramsHash))
			);
	}
}
