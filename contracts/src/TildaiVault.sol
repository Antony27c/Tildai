// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice A merchant's onchain cash box. The owner can always take everything out; the agent can only
/// allocate, withdraw to the owner's payout wallet and swap wARS for USDT on Textile, within limits.
contract TildaiVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Bucket {
        Operating,
        Savings,
        Taxes
    }

    IERC20 public immutable wars;
    IERC20 public immutable usdt;
    uint256 public immutable usdtUnit;

    address public owner;
    address public agent;
    address public payoutWallet;
    bool public paused;

    /// wARS (wei) the agent may withdraw plus swap per Argentine day.
    uint256 public dailyCap;
    /// Max wARS (wei) paid for one whole USDT.
    uint256 public maxRate;
    /// Max wARS (wei) per swap.
    uint256 public maxSwap;
    bool public canSwapSavings;
    bool public canSwapTaxes;

    uint256 public savings;
    uint256 public taxes;
    uint256 public spentDay;
    uint256 public spentToday;

    mapping(address => bool) public isTextile;
    mapping(bytes32 => bool) public usedOp;

    event Allocated(bytes32 indexed opId, Bucket bucket, uint256 amount);
    event Withdrawn(bytes32 indexed opId, address to, uint256 amount);
    event Swapped(bytes32 indexed opId, Bucket from, uint256 warsSpent, uint256 usdtReceived);
    event OwnerWithdrawn(address indexed token, address to, uint256 amount);
    event LimitsSet(uint256 dailyCap, uint256 maxRate, uint256 maxSwap);
    event PausedSet(bool paused);
    event AgentSet(address agent);
    event PayoutWalletSet(address payoutWallet);
    event TextileSet(address target, bool allowed);
    event SwapPermissionsSet(bool savings, bool taxes);

    error NotOwner();
    error NotAgent();
    error IsPaused();
    error ZeroAddress();
    error OpUsed();
    error InvalidBucket();
    error InsufficientFunds();
    error DailyCapExceeded();
    error SwapTooLarge();
    error NotTextile();
    error BucketLocked();
    error SwapFailed(bytes reason);
    error BadSwapResult();
    error RateTooHigh();
    error OnlyTighten();
    error ForbiddenTarget();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyActiveAgent() {
        if (msg.sender != agent) revert NotAgent();
        if (paused) revert IsPaused();
        _;
    }

    constructor(
        IERC20 wars_,
        IERC20 usdt_,
        address owner_,
        address agent_,
        address payoutWallet_,
        uint256 dailyCap_,
        uint256 maxRate_,
        uint256 maxSwap_,
        address[] memory textile
    ) {
        if (address(wars_) == address(0) || address(usdt_) == address(0) || wars_ == usdt_) revert ZeroAddress();
        if (owner_ == address(0) || agent_ == address(0) || payoutWallet_ == address(0)) revert ZeroAddress();
        wars = wars_;
        usdt = usdt_;
        usdtUnit = 10 ** IERC20Metadata(address(usdt_)).decimals();
        owner = owner_;
        agent = agent_;
        payoutWallet = payoutWallet_;
        _setLimits(dailyCap_, maxRate_, maxSwap_);
        for (uint256 i; i < textile.length; ++i) {
            _setTextile(textile[i], true);
        }
    }

    // ---------------------------------------------------------------- views

    /// wARS the agent can withdraw or swap: everything not set aside.
    function operating() public view returns (uint256) {
        uint256 bal = wars.balanceOf(address(this));
        uint256 locked = savings + taxes;
        return bal > locked ? bal - locked : 0;
    }

    // ---------------------------------------------------------------- agent

    function allocate(bytes32 opId, Bucket to, uint256 amount) external onlyActiveAgent {
        _useOp(opId);
        if (to == Bucket.Operating) revert InvalidBucket();
        if (amount > operating()) revert InsufficientFunds();
        if (to == Bucket.Savings) savings += amount;
        else taxes += amount;
        emit Allocated(opId, to, amount);
    }

    function withdraw(bytes32 opId, uint256 amount) external onlyActiveAgent nonReentrant {
        _useOp(opId);
        if (amount > operating()) revert InsufficientFunds();
        _spend(amount);
        wars.safeTransfer(payoutWallet, amount);
        emit Withdrawn(opId, payoutWallet, amount);
    }

    /// @notice Fills a Textile RFQ quote with this vault as taker (see docs/adr/0001).
    /// `spender`, `target` and `data` come from the quote; the vault only trusts the balance deltas.
    function swap(
        bytes32 opId,
        Bucket from,
        address spender,
        address target,
        bytes calldata data,
        uint256 amountIn,
        uint256 minOut
    ) external onlyActiveAgent nonReentrant {
        _useOp(opId);
        if (!isTextile[spender] || !isTextile[target]) revert NotTextile();
        if (amountIn > maxSwap) revert SwapTooLarge();
        if (from == Bucket.Savings && !canSwapSavings) revert BucketLocked();
        if (from == Bucket.Taxes && !canSwapTaxes) revert BucketLocked();
        if (amountIn > _available(from)) revert InsufficientFunds();

        uint256 warsBefore = wars.balanceOf(address(this));
        uint256 usdtBefore = usdt.balanceOf(address(this));
        wars.forceApprove(spender, amountIn);
        (bool ok, bytes memory reason) = target.call(data);
        if (!ok) revert SwapFailed(reason);
        wars.forceApprove(spender, 0);

        // Underflows revert: the swap may never add wARS or take USDT.
        uint256 spent = warsBefore - wars.balanceOf(address(this));
        uint256 received = usdt.balanceOf(address(this)) - usdtBefore;
        if (spent == 0 || spent > amountIn || received < minOut) revert BadSwapResult();
        if (spent * usdtUnit > received * maxRate) revert RateTooHigh();
        _spend(spent);
        if (from == Bucket.Savings) savings -= spent;
        else if (from == Bucket.Taxes) taxes -= spent;
        emit Swapped(opId, from, spent, received);
    }

    // ---------------------------------------------------------------- owner or agent

    /// The owner sets any limits; the agent may only make each one stricter.
    function setLimits(uint256 dailyCap_, uint256 maxRate_, uint256 maxSwap_) external {
        if (msg.sender != owner) {
            if (msg.sender != agent) revert NotAgent();
            if (dailyCap_ > dailyCap || maxRate_ > maxRate || maxSwap_ > maxSwap) revert OnlyTighten();
        }
        _setLimits(dailyCap_, maxRate_, maxSwap_);
    }

    /// The owner pauses or resumes the agent; the agent may only pause itself.
    function setPaused(bool paused_) external {
        if (msg.sender != owner) {
            if (msg.sender != agent) revert NotAgent();
            if (!paused_) revert OnlyTighten();
        }
        paused = paused_;
        emit PausedSet(paused_);
    }

    // ---------------------------------------------------------------- owner

    /// The owner can take any token out at any time. wARS comes from operating first, then savings, then taxes.
    function ownerWithdraw(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (token == wars) {
            uint256 op = operating();
            if (amount > op) {
                uint256 rest = amount - op;
                uint256 fromSavings = rest < savings ? rest : savings;
                rest -= fromSavings;
                if (rest > taxes) revert InsufficientFunds();
                savings -= fromSavings;
                taxes -= rest;
            }
        }
        token.safeTransfer(to, amount);
        emit OwnerWithdrawn(address(token), to, amount);
    }

    function setAgent(address agent_) external onlyOwner {
        if (agent_ == address(0)) revert ZeroAddress();
        agent = agent_;
        emit AgentSet(agent_);
    }

    function setPayoutWallet(address payoutWallet_) external onlyOwner {
        if (payoutWallet_ == address(0)) revert ZeroAddress();
        payoutWallet = payoutWallet_;
        emit PayoutWalletSet(payoutWallet_);
    }

    function setTextile(address target, bool allowed) external onlyOwner {
        _setTextile(target, allowed);
    }

    function setSwapPermissions(bool savings_, bool taxes_) external onlyOwner {
        canSwapSavings = savings_;
        canSwapTaxes = taxes_;
        emit SwapPermissionsSet(savings_, taxes_);
    }

    // ---------------------------------------------------------------- internal

    function _available(Bucket b) internal view returns (uint256) {
        if (b == Bucket.Savings) return savings;
        if (b == Bucket.Taxes) return taxes;
        return operating();
    }

    function _useOp(bytes32 opId) internal {
        if (usedOp[opId]) revert OpUsed();
        usedOp[opId] = true;
    }

    /// Counts against the daily cap. Days roll over at 00:00 Argentina (UTC-3, no DST).
    function _spend(uint256 amount) internal {
        uint256 day = (block.timestamp - 3 hours) / 1 days;
        if (day != spentDay) {
            spentDay = day;
            spentToday = 0;
        }
        spentToday += amount;
        if (spentToday > dailyCap) revert DailyCapExceeded();
    }

    function _setLimits(uint256 dailyCap_, uint256 maxRate_, uint256 maxSwap_) internal {
        dailyCap = dailyCap_;
        maxRate = maxRate_;
        maxSwap = maxSwap_;
        emit LimitsSet(dailyCap_, maxRate_, maxSwap_);
    }

    function _setTextile(address target, bool allowed) internal {
        // A token or the vault itself as call target would let calldata move funds directly.
        if (target == address(0) || target == address(wars) || target == address(usdt) || target == address(this)) {
            revert ForbiddenTarget();
        }
        isTextile[target] = allowed;
        emit TextileSet(target, allowed);
    }
}
