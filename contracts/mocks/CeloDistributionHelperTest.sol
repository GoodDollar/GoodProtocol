pragma solidity >=0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../reserve/CeloDistributionHelper.sol";

contract CeloDistributionHelperTest is CeloDistributionHelper {
	function onDistribution(uint256 _amount) external override {
		revert();
	}
}

contract CeloDistributionHelperTestHelper is CeloDistributionHelper {
	function setOracle(IStaticOracle oracle) external {
		STATIC_ORACLE = oracle;
	}

	function setBridges(address _mpbBridge) external {
		mpbBridge = IMessagePassingBridge(_mpbBridge);
	}
}
