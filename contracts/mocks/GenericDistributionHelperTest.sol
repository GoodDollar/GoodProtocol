pragma solidity >=0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../reserve/GenericDistributionHelper.sol";

contract GenericDistributionHelperTest is GenericDistributionHelper {
	function onDistribution(uint256 _amount) external override {
		revert();
	}
}

contract GenericDistributionHelperTestHelper is GenericDistributionHelper {
	IMessagePassingBridge bridge;

	function setOracle(IStaticOracle oracle) external {
		STATIC_ORACLE = oracle;
	}

	function getBridge() public view override returns (IMessagePassingBridge) {
		return bridge;
	}

	function setBridges(address _mpbBridge) external {
		bridge = IMessagePassingBridge(_mpbBridge);
	}
}
