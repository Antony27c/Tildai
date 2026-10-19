// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TildaiVault} from "../src/TildaiVault.sol";
import {TildaiFactory} from "../src/TildaiFactory.sol";

/// Real wARS and USDT on a Celo mainnet fork. Run with: FORK=1 forge test --match-contract Fork
contract TildaiVaultForkTest is Test {
    IERC20 constant WARS = IERC20(0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D);
    IERC20 constant USDT = IERC20(0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e);
    // docs.textilecredit.com/protocol/address-book, Celo (42220)
    address constant TEXTILE_REACTOR = 0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3;
    address constant TEXTILE_EXECUTOR = 0x01b006d5c687bde182aa36F542f1f014144742e2;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address payout = makeAddr("payout");
    TildaiVault vault;

    function setUp() public {
        if (!vm.envOr("FORK", false)) vm.skip(true);
        vm.createSelectFork("celo");
        address[] memory targets = new address[](2);
        targets[0] = TEXTILE_REACTOR;
        targets[1] = TEXTILE_EXECUTOR;
        TildaiFactory factory = new TildaiFactory(WARS, USDT, agent, targets);
        vm.prank(agent);
        vault = factory.createVault(owner, payout, 100_000e18, 1_700e18, 60_000e18);
    }

    function test_fork_realTokens() public {
        assertGt(TEXTILE_REACTOR.code.length, 0);
        assertGt(TEXTILE_EXECUTOR.code.length, 0);
        assertEq(vault.usdtUnit(), 1e6);

        // A customer payment is a plain wARS transfer to the vault.
        deal(address(WARS), address(this), 30_000e18);
        WARS.transfer(address(vault), 30_000e18);
        deal(address(USDT), address(vault), 5e6);

        vm.startPrank(agent);
        vault.allocate("a1", TildaiVault.Bucket.Savings, 10_000e18);
        vault.withdraw("w1", 15_000e18);
        vm.stopPrank();
        assertEq(WARS.balanceOf(payout), 15_000e18);
        assertEq(vault.operating(), 5_000e18);

        vm.startPrank(owner);
        vault.ownerWithdraw(WARS, owner, 15_000e18);
        vault.ownerWithdraw(USDT, owner, 5e6);
        assertEq(WARS.balanceOf(owner), 15_000e18);
        assertEq(USDT.balanceOf(owner), 5e6);
        assertEq(vault.savings(), 0);
    }
}
