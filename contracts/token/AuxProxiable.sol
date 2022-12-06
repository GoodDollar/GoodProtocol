// SPDX-License-Identifier: AGPLv3
pragma solidity 0.8.16;

import { AuxUtils } from "./AuxUtils.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title Aux (Auxiliary) Proxiable contract.
 * Replicates the UUPS standard, suited for having a secondary logic contract a proxy can delegate to
 */
abstract contract AuxProxiable is Initializable {

    /// emitted when updating to another logic contract
    event CodeUpdated(bytes32 uuid, address codeAddress);

    // returns true if calls matching the given selector shall be delegated to the auxiliary logic contract
    function implementsFn(bytes4 selector) external virtual pure returns(bool);

    /**
     * @dev Get current implementation code address.
     */
    function getAuxCodeAddress() public view returns (address codeAddress)
    {
        return AuxUtils.implementation();
    }

    /// to be implemented by the overriding contract with permission checks in place
    function updateAuxCode(address newAddress) external virtual;

    /**
     * @dev Proxiable UUID marker function, this would help to avoid wrong logic
     *      contract to be used for upgrading.
     *
     * NOTE: The semantics of the UUID deviates from the actual UUPS standard,
     *       where it is equivalent of _IMPLEMENTATION_SLOT.
     */
    function proxiableAuxUUID() public view virtual returns (bytes32);

    /**
     * @dev Update code address function.
     *      It is internal, so the derived contract could setup its own permission logic.
     */
    function _updateCodeAddress(address newAddress) internal
    {
        // require initializeProxy first
        require(AuxUtils.implementation() != address(0), "AuxProxiable: not upgradable");
        require(
            proxiableAuxUUID() == AuxProxiable(newAddress).proxiableAuxUUID(),
            "AuxProxiable: not compatible logic"
        );
        require(
            address(this) != newAddress,
            "AuxProxiable: proxy loop"
        );
        AuxUtils.setImplementation(newAddress);
        emit CodeUpdated(proxiableAuxUUID(), newAddress);
    }
}
