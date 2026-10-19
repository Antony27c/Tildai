// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TildaiVault} from "./TildaiVault.sol";

/// @notice Deploys one TildaiVault per merchant and keeps the registry the payment page trusts.
contract TildaiFactory {
    IERC20 public immutable wars;
    IERC20 public immutable usdt;
    // shortcut: fixed agent; if its key leaks, redeploy the factory and each owner calls setAgent on their vault.
    address public immutable agent;
    address[] public textile;

    mapping(address => bool) public isVault;

    event VaultCreated(address indexed vault, address indexed owner);

    error NotAgent();

    constructor(IERC20 wars_, IERC20 usdt_, address agent_, address[] memory textile_) {
        wars = wars_;
        usdt = usdt_;
        agent = agent_;
        textile = textile_;
    }

    function createVault(address owner, address payoutWallet, uint256 dailyCap, uint256 maxRate, uint256 maxSwap)
        external
        returns (TildaiVault vault)
    {
        if (msg.sender != agent) revert NotAgent();
        vault = new TildaiVault(wars, usdt, owner, agent, payoutWallet, dailyCap, maxRate, maxSwap, textile);
        isVault[address(vault)] = true;
        emit VaultCreated(address(vault), owner);
    }
}
