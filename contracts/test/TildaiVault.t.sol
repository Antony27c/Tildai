// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TildaiVault} from "../src/TildaiVault.sol";
import {TildaiFactory} from "../src/TildaiFactory.sol";

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

/// Behaves like the Textile settlement: pulls the taker side from msg.sender, pays the maker side to it.
contract MockTextile {
    IERC20 immutable wars;
    IERC20 immutable usdt;

    constructor(IERC20 wars_, IERC20 usdt_) {
        wars = wars_;
        usdt = usdt_;
    }

    function fill(uint256 warsIn, uint256 usdtOut) external {
        wars.transferFrom(msg.sender, address(this), warsIn);
        usdt.transfer(msg.sender, usdtOut);
    }

    function steal(uint256 usdtAmount) external {
        usdt.transferFrom(msg.sender, address(this), usdtAmount);
    }

    function boom() external pure {
        revert("no quote");
    }
}

contract TildaiVaultTest is Test {
    MockToken wars = new MockToken("wARS", 18);
    MockToken usdt = new MockToken("USDT", 6);
    MockTextile textile = new MockTextile(IERC20(address(wars)), IERC20(address(usdt)));
    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address payout = makeAddr("payout");
    TildaiFactory factory;
    TildaiVault vault;

    uint256 constant CAP = 100_000e18;
    uint256 constant RATE = 1_700e18; // wARS per USDT
    uint256 constant MAX_SWAP = 60_000e18;

    function setUp() public {
        vm.warp(1_792_000_000);
        address[] memory targets = new address[](1);
        targets[0] = address(textile);
        factory = new TildaiFactory(IERC20(address(wars)), IERC20(address(usdt)), agent, targets);
        vm.prank(agent);
        vault = factory.createVault(owner, payout, CAP, RATE, MAX_SWAP);
        wars.mint(address(vault), 200_000e18);
        usdt.mint(address(textile), 1_000e6);
    }

    function _fill(uint256 warsIn, uint256 usdtOut) internal pure returns (bytes memory) {
        return abi.encodeCall(MockTextile.fill, (warsIn, usdtOut));
    }

    function _swap(bytes32 id, TildaiVault.Bucket from, uint256 warsIn, uint256 usdtOut) internal {
        vm.prank(agent);
        vault.swap(id, from, address(textile), address(textile), _fill(warsIn, usdtOut), warsIn, usdtOut);
    }

    // ------------------------------------------------------------ factory

    function test_factory_registersVaultWithConfig() public view {
        assertTrue(factory.isVault(address(vault)));
        assertEq(vault.owner(), owner);
        assertEq(vault.agent(), agent);
        assertEq(vault.payoutWallet(), payout);
        assertEq(vault.dailyCap(), CAP);
        assertTrue(vault.isTextile(address(textile)));
        assertEq(vault.usdtUnit(), 1e6);
    }

    function test_factory_onlyAgentCreates() public {
        vm.expectRevert(TildaiFactory.NotAgent.selector);
        factory.createVault(owner, payout, CAP, RATE, MAX_SWAP);
    }

    // ------------------------------------------------------------ allocate

    function test_allocate_locksFundsFromAgent() public {
        vm.startPrank(agent);
        vault.allocate("a1", TildaiVault.Bucket.Savings, 150_000e18);
        vault.allocate("a2", TildaiVault.Bucket.Taxes, 50_000e18);
        assertEq(vault.operating(), 0);
        vm.expectRevert(TildaiVault.InsufficientFunds.selector);
        vault.withdraw("w1", 1);
        vm.expectRevert(TildaiVault.InsufficientFunds.selector);
        vault.allocate("a3", TildaiVault.Bucket.Savings, 1);
        vm.expectRevert(TildaiVault.InvalidBucket.selector);
        vault.allocate("a4", TildaiVault.Bucket.Operating, 0);
    }

    // ------------------------------------------------------------ withdraw and daily cap

    function test_withdraw_onlyToPayoutWallet() public {
        vm.prank(agent);
        vault.withdraw("w1", 50_000e18);
        assertEq(wars.balanceOf(payout), 50_000e18);
        assertEq(vault.spentToday(), 50_000e18);
    }

    function test_withdraw_dailyCapResetsAtArgentineMidnight() public {
        // 02:59:59 UTC is still 23:59:59 the previous day in Argentina.
        uint256 dayStart = ((block.timestamp - 3 hours) / 1 days + 1) * 1 days + 3 hours;
        vm.warp(dayStart - 1);
        vm.startPrank(agent);
        vault.withdraw("w1", CAP);
        vm.expectRevert(TildaiVault.DailyCapExceeded.selector);
        vault.withdraw("w2", 1);
        vm.warp(dayStart);
        vault.withdraw("w3", 1);
        assertEq(vault.spentToday(), 1);
    }

    function test_opId_cannotBeReused() public {
        vm.startPrank(agent);
        vault.withdraw("same", 1);
        vm.expectRevert(TildaiVault.OpUsed.selector);
        vault.withdraw("same", 1);
        vm.expectRevert(TildaiVault.OpUsed.selector);
        vault.allocate("same", TildaiVault.Bucket.Savings, 1);
    }

    function test_onlyAgent_andNotWhenPaused() public {
        vm.expectRevert(TildaiVault.NotAgent.selector);
        vault.withdraw("w1", 1);
        vm.prank(owner);
        vm.expectRevert(TildaiVault.NotAgent.selector);
        vault.withdraw("w1", 1);

        vm.prank(agent);
        vault.setPaused(true);
        vm.prank(agent);
        vm.expectRevert(TildaiVault.IsPaused.selector);
        vault.withdraw("w1", 1);
    }

    // ------------------------------------------------------------ swap

    function test_swap_happyPath() public {
        _swap("s1", TildaiVault.Bucket.Operating, 17_000e18, 10e6);
        assertEq(usdt.balanceOf(address(vault)), 10e6);
        assertEq(wars.balanceOf(address(vault)), 183_000e18);
        assertEq(vault.spentToday(), 17_000e18);
        assertEq(wars.allowance(address(vault), address(textile)), 0);
    }

    function test_swap_rejectsRateAboveMax() public {
        vm.expectRevert(TildaiVault.RateTooHigh.selector);
        _swap("s1", TildaiVault.Bucket.Operating, 17_001e18, 10e6);
    }

    function test_swap_rejectsLessThanMinOut() public {
        vm.prank(agent);
        vm.expectRevert(TildaiVault.BadSwapResult.selector);
        vault.swap("s1", TildaiVault.Bucket.Operating, address(textile), address(textile), _fill(1_700e18, 1e6), 1_700e18, 2e6);
    }

    function test_swap_cannotPullMoreThanAmountIn() public {
        vm.prank(agent);
        vm.expectRevert(); // allowance is exactly amountIn
        vault.swap("s1", TildaiVault.Bucket.Operating, address(textile), address(textile), _fill(2_000e18, 10e6), 1_000e18, 0);
    }

    function test_swap_cannotTakeUsdtOut() public {
        usdt.mint(address(vault), 5e6);
        vm.prank(agent);
        vm.expectRevert(); // the vault never approves USDT
        vault.swap("s1", TildaiVault.Bucket.Operating, address(textile), address(textile), abi.encodeCall(MockTextile.steal, (5e6)), 1, 0);
    }

    function test_swap_bubblesTextileRevertAndLeavesNoApproval() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(TildaiVault.SwapFailed.selector, abi.encodeWithSignature("Error(string)", "no quote"))
        );
        vault.swap("s1", TildaiVault.Bucket.Operating, address(textile), address(textile), abi.encodeCall(MockTextile.boom, ()), 1, 0);
        assertEq(wars.allowance(address(vault), address(textile)), 0);
    }

    function test_swap_onlyTextileTargets() public {
        address evil = makeAddr("evil");
        vm.prank(agent);
        vm.expectRevert(TildaiVault.NotTextile.selector);
        vault.swap("s1", TildaiVault.Bucket.Operating, evil, address(textile), _fill(1, 0), 1, 0);
        vm.prank(agent);
        vm.expectRevert(TildaiVault.NotTextile.selector);
        vault.swap("s2", TildaiVault.Bucket.Operating, address(textile), evil, "", 1, 0);
    }

    function test_swap_respectsMaxSwapAndDailyCap() public {
        vm.expectRevert(TildaiVault.SwapTooLarge.selector);
        _swap("s1", TildaiVault.Bucket.Operating, MAX_SWAP + 1, 100e6);

        vm.prank(agent);
        vault.withdraw("w1", 90_000e18);
        vm.expectRevert(TildaiVault.DailyCapExceeded.selector);
        _swap("s2", TildaiVault.Bucket.Operating, 17_000e18, 10e6);
    }

    function test_swap_fromBucketsNeedsOwnerPermission() public {
        vm.prank(agent);
        vault.allocate("a1", TildaiVault.Bucket.Savings, 20_000e18);

        vm.expectRevert(TildaiVault.BucketLocked.selector);
        _swap("s1", TildaiVault.Bucket.Savings, 17_000e18, 10e6);
        vm.expectRevert(TildaiVault.BucketLocked.selector);
        _swap("s2", TildaiVault.Bucket.Taxes, 17_000e18, 10e6);

        vm.prank(owner);
        vault.setSwapPermissions(true, false);
        _swap("s3", TildaiVault.Bucket.Savings, 17_000e18, 10e6);
        assertEq(vault.savings(), 3_000e18);
        assertEq(vault.operating(), 180_000e18);

        vm.expectRevert(TildaiVault.InsufficientFunds.selector);
        _swap("s4", TildaiVault.Bucket.Savings, 17_000e18, 10e6);
    }

    // ------------------------------------------------------------ limits and permissions

    function test_setLimits_agentOnlyTightens() public {
        vm.startPrank(agent);
        vault.setLimits(CAP / 2, RATE - 1, MAX_SWAP);
        assertEq(vault.dailyCap(), CAP / 2);
        vm.expectRevert(TildaiVault.OnlyTighten.selector);
        vault.setLimits(CAP, RATE - 1, MAX_SWAP);
        vm.expectRevert(TildaiVault.OnlyTighten.selector);
        vault.setLimits(CAP / 2, RATE, MAX_SWAP);
        vm.stopPrank();

        vm.prank(owner);
        vault.setLimits(CAP * 2, RATE * 2, MAX_SWAP * 2);
        assertEq(vault.maxRate(), RATE * 2);

        vm.expectRevert(TildaiVault.NotAgent.selector);
        vault.setLimits(0, 0, 0);
    }

    function test_setPaused_agentCannotUnpause() public {
        vm.prank(agent);
        vault.setPaused(true);
        vm.prank(agent);
        vm.expectRevert(TildaiVault.OnlyTighten.selector);
        vault.setPaused(false);
        vm.prank(owner);
        vault.setPaused(false);
        assertFalse(vault.paused());
    }

    function test_ownerOnlySettings() public {
        vm.startPrank(agent);
        vm.expectRevert(TildaiVault.NotOwner.selector);
        vault.setAgent(agent);
        vm.expectRevert(TildaiVault.NotOwner.selector);
        vault.setPayoutWallet(agent);
        vm.expectRevert(TildaiVault.NotOwner.selector);
        vault.setTextile(agent, true);
        vm.expectRevert(TildaiVault.NotOwner.selector);
        vault.setSwapPermissions(true, true);
        vm.expectRevert(TildaiVault.NotOwner.selector);
        vault.ownerWithdraw(IERC20(address(wars)), agent, 1);
    }

    function test_setTextile_rejectsTokensAndVault() public {
        vm.startPrank(owner);
        vm.expectRevert(TildaiVault.ForbiddenTarget.selector);
        vault.setTextile(address(wars), true);
        vm.expectRevert(TildaiVault.ForbiddenTarget.selector);
        vault.setTextile(address(usdt), true);
        vm.expectRevert(TildaiVault.ForbiddenTarget.selector);
        vault.setTextile(address(vault), true);
    }

    // ------------------------------------------------------------ owner withdraw

    function test_ownerWithdraw_takesEverythingIncludingBuckets() public {
        vm.startPrank(agent);
        vault.allocate("a1", TildaiVault.Bucket.Savings, 50_000e18);
        vault.allocate("a2", TildaiVault.Bucket.Taxes, 30_000e18);
        vm.stopPrank();
        _swap("s1", TildaiVault.Bucket.Operating, 17_000e18, 10e6);

        vm.startPrank(owner);
        vault.ownerWithdraw(IERC20(address(wars)), owner, 140_000e18); // 103k operating + 37k savings
        assertEq(vault.savings(), 13_000e18);
        assertEq(vault.taxes(), 30_000e18);
        vault.ownerWithdraw(IERC20(address(wars)), owner, 43_000e18);
        assertEq(vault.savings(), 0);
        assertEq(vault.taxes(), 0);
        vault.ownerWithdraw(IERC20(address(usdt)), owner, 10e6);
        assertEq(wars.balanceOf(owner), 183_000e18);
        assertEq(usdt.balanceOf(owner), 10e6);

        vm.expectRevert(TildaiVault.InsufficientFunds.selector);
        vault.ownerWithdraw(IERC20(address(wars)), owner, 1);
    }

    function test_ownerWithdraw_worksWhilePaused() public {
        vm.startPrank(owner);
        vault.setPaused(true);
        vault.ownerWithdraw(IERC20(address(wars)), owner, 200_000e18);
        assertEq(wars.balanceOf(owner), 200_000e18);
    }
}
