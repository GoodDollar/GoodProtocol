// SPDX-License-Identifier: MIT
pragma solidity >=0.8;

import "../token/FeesFormula.sol";

contract FeesFormulaMock is IFeesFormula {
    uint256 public immutable feePerMillion;

    constructor(uint256 feePerMillion_) {
        require(feePerMillion_ <= 1e6, "fee higher than 100%");
        feePerMillion = feePerMillion_;
    }

    function getTxFees(
        uint256 value,
        address sender,
        address recipient
    ) external view returns (uint256 fee, bool senderPays) {
        return (value * feePerMillion / 1E6, true);
    }
}