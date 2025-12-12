// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { MintBurnOFTAdapter } from "@layerzerolabs/oft-evm/contracts/MintBurnOFTAdapter.sol";
import { IMintableBurnable } from "@layerzerolabs/oft-evm/contracts/interfaces/IMintableBurnable.sol";

contract GoodDollarOFTAdapter is MintBurnOFTAdapter {
    constructor(
    address _token,                   // Your existing ERC20 token with mint/burn exposed
    IMintableBurnable _minterBurner,  // Contract with mint/burn privileges
    address _lzEndpoint,              // Local LayerZero endpoint
    address _owner                    // Contract owner
    ) MintBurnOFTAdapter(_token, _minterBurner, _lzEndpoint, _owner) {
        _transferOwnership(_owner);
    }
}