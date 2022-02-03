// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "./GoodCompoundStakingV2.sol";
import "../../Interfaces.sol";

/**
 * @title Staking contract that donates earned interest to the DAO
 * allowing stakers to deposit Token
 * or withdraw their stake in Token
 * the contracts buy cToken and can transfer the daily interest to the  DAO
 */
contract CompoundStakingFactory {
	using ClonesUpgradeable for address;

	address public impl = address(new GoodCompoundStakingV2());

	event Deployed(address proxy, address cToken, address impl);

	function clone(
		address _impl,
		cERC20 cToken,
		bytes32 paramsHash
	) internal returns (GoodCompoundStakingV2) {
		address deployed = address(_impl).cloneDeterministic(
			keccak256(abi.encodePacked(address(cToken), paramsHash))
		);
		emit Deployed(deployed, address(cToken), _impl);
		return GoodCompoundStakingV2(deployed);
	}

	function cloneAndInit(
		cERC20 _cToken,
		INameService _ns,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		address _compUsdOracle,
		address[] memory _tokenToDaiSwapPath
	) public {
		cloneAndInit(
			impl,
			_cToken,
			_ns,
			_maxRewardThreshold,
			_tokenUsdOracle,
			_compUsdOracle,
			_tokenToDaiSwapPath
		);
	}

	/**
	@dev Function to clone Staking contract and initialize new one with new ctoken
	@param _impl address of contract to clone
	@param cToken Staking cToken to use in staking contract
	@param _ns NameService that holds whole necessary addresses
	@param _maxRewardThreshold Block numbers that need to pass in order to user would get their rewards with 1x multiplier instead of 0.5x
	@param _tokenUsdOracle address of the TOKEN/USD oracle
	@param _compUsdOracle address of the AAVE/USD oracle
	 */
	function cloneAndInit(
		address _impl,
		cERC20 cToken,
		INameService _ns,
		uint64 _maxRewardThreshold,
		address _tokenUsdOracle,
		address _compUsdOracle,
		address[] memory _tokenToDaiSwapPath
	) public {
		GoodCompoundStakingV2 deployed = clone(
			_impl,
			cToken,
			keccak256(
				abi.encodePacked(
					address(_ns),
					_maxRewardThreshold,
					_tokenUsdOracle,
					_tokenToDaiSwapPath
				)
			)
		);
		deployed.init(
			cToken.underlying(),
			address(cToken),
			_ns,
			string(abi.encodePacked("GoodCompoundStakingV2 ", cToken.name())),
			string(abi.encodePacked("g", cToken.symbol())),
			_maxRewardThreshold,
			_tokenUsdOracle,
			_compUsdOracle,
			_tokenToDaiSwapPath
		);
	}

	function predictAddress(
		address _impl,
		cERC20 cToken,
		bytes32 paramsHash
	) public view returns (address) {
		return
			address(_impl).predictDeterministicAddress(
				keccak256(abi.encodePacked(address(cToken), paramsHash))
			);
	}
}
