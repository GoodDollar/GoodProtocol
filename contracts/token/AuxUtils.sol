// SPDX-License-Identifier: AGPLv3
pragma solidity 0.8.16;

/**
 * @title Aux (Auxiliary)) Shared Library for auxiliary proxy functionality
 */
library AuxUtils {

    /**
     * @dev Implementation slot constant.
     * Using https://eips.ethereum.org/EIPS/eip-1967 mechanism, but with different storage slot
     * Storage slot 0x7351c6b505b3b18ada3f04d0f777861f75370f61662c63745c217890c2003c73
     * (obtained as bytes32(uint256(keccak256('aux.proxy.implementation')) - 1)).
     */
    bytes32 internal constant _IMPLEMENTATION_SLOT = 0x7351c6b505b3b18ada3f04d0f777861f75370f61662c63745c217890c2003c73;

    /// @dev Get implementation address.
    function implementation() internal view returns (address impl) {
        assembly { // solium-disable-line
            impl := sload(_IMPLEMENTATION_SLOT)
        }
    }

    /// @dev Set new implementation address.
    function setImplementation(address codeAddress) internal {
        assembly {
        // solium-disable-line
            sstore(
            _IMPLEMENTATION_SLOT,
            codeAddress
            )
        }
    }
}
