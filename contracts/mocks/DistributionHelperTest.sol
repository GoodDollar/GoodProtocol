pragma solidity >=0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../reserve/DistributionHelper.sol";

contract DistributionHelperTest is DistributionHelper {
	function onDistribution(uint256 _amount) external override {
		revert();
	}
}

contract DistributionHelperTestHelper is DistributionHelper {
	function setBridges(address _fuseBridge, address _multiBridge) external {
		fuseBridge = _fuseBridge;
		multiChainBridge = IMultichainRouter(_multiBridge);
	}
}
