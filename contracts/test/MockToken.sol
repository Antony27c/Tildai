// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test token with open mint. Also deployed on Celo Sepolia, where wARS and USDT don't exist.
contract MockToken is ERC20 {
    uint8 private immutable dec;

    constructor(string memory name, uint8 dec_) ERC20(name, name) {
        dec = dec_;
    }

    function decimals() public view override returns (uint8) {
        return dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
