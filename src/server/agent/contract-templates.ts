import type { AppSpec } from "./spec";

/**
 * GoodBuild's audited contract templates (D165, owner, 21 Nov 2026: "preload standard audited templates ERC20,
 * ERC721, staking and vote, escrow, vesting, governance ... so that it will be much easier").
 *
 * Each template is an abstract base built from OpenZeppelin 5's audited parts. It goes into the project as
 * contracts/goodbuild/<Name>.sol, which the builder can import but never edit (pathProblem), and the builder's
 * own contract inherits it and only sets its values: a name, a price, a duration. Money moves only through the
 * template's code, which GoodBuild has compiled and tested (contract-templates.test.ts), so a model never writes
 * the parts where funds get lost. The compiled child's ABI includes everything it inherits, and GoodBuild
 * exports it to the front end as before (src/contracts/<Name>.ts).
 *
 * Safe zones: inherit, don't copy. A project contract that redeclares an OpenZeppelin or template contract is
 * refused by the checks (copiedBaseIssues in checks.ts).
 */

export const TEMPLATE_DIR = "contracts/goodbuild/";

export type TemplateId = "token" | "nft" | "staking" | "escrow" | "vesting" | "governance" | "poll" | "savings";
export const TEMPLATE_IDS: TemplateId[] = ["token", "nft", "staking", "escrow", "vesting", "governance", "poll", "savings"];

export interface ContractTemplate {
  id: TemplateId;
  /** What it is, for the spec's planner. */
  label: string;
  /** Words in a spec contract that pick it when the planner names none. */
  match: RegExp;
  /** contracts/goodbuild/<file> -> Solidity. */
  files: Record<string, string>;
  /** How to use it: the child contract, the deploy manifest, the test. Sent with the contracts phase. */
  guide: string;
}

const HEADER = (what: string) => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// GoodBuild template: ${what}
/// Built from audited OpenZeppelin parts and tested by GoodBuild. Inherit it; don't copy or edit it.`;

const GOOD_TOKEN = `${HEADER("an ERC-20 with a fixed supply, minted once to the holder. Nobody can mint more, pause, block or tax transfers; holders can burn their own.")}

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

abstract contract GoodToken is ERC20, ERC20Burnable, ERC20Permit {
    error ZeroHolder();

    constructor(string memory name_, string memory symbol_, uint256 supply_, address holder_) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (holder_ == address(0)) revert ZeroHolder();
        _mint(holder_, supply_);
    }
}
`;

const GOOD_NFT = `${HEADER("an ERC-721 collection. Anyone mints the next one, free or for a price in an ERC-20 such as G$, up to a max supply and an optional limit per wallet. The owner sets the metadata link and takes the takings out.")}

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract GoodNFT is ERC721, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// The token the price is paid in; address(0) when minting is free.
    IERC20 public immutable payToken;
    uint256 public immutable price;
    uint256 public immutable maxSupply;
    /// 0 means no limit.
    uint256 public immutable maxPerWallet;
    uint256 public totalMinted;
    mapping(address => uint256) public mintedBy;
    string private baseTokenURI;

    error SoldOut();
    error WalletLimitReached();
    error PriceNeedsToken();
    error ZeroSupply();
    error NothingToWithdraw();
    error ZeroAddress();

    event Minted(address indexed to, uint256 indexed tokenId);
    event BaseURISet(string uri);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        IERC20 payToken_,
        uint256 price_,
        uint256 maxSupply_,
        uint256 maxPerWallet_,
        string memory baseURI_,
        address owner_
    ) ERC721(name_, symbol_) Ownable(owner_) {
        if (price_ != 0 && address(payToken_) == address(0)) revert PriceNeedsToken();
        if (maxSupply_ == 0) revert ZeroSupply();
        payToken = payToken_;
        price = price_;
        maxSupply = maxSupply_;
        maxPerWallet = maxPerWallet_;
        baseTokenURI = baseURI_;
    }

    /// Mints the next token to the caller, paying the price first (approve payToken for price before).
    function mint() external nonReentrant returns (uint256 tokenId) {
        if (totalMinted >= maxSupply) revert SoldOut();
        if (maxPerWallet != 0 && mintedBy[msg.sender] >= maxPerWallet) revert WalletLimitReached();
        tokenId = ++totalMinted;
        mintedBy[msg.sender] += 1;
        if (price != 0) payToken.safeTransferFrom(msg.sender, address(this), price);
        _mint(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId);
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        baseTokenURI = uri;
        emit BaseURISet(uri);
    }

    function withdraw(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (address(payToken) == address(0)) revert NothingToWithdraw();
        uint256 amount = payToken.balanceOf(address(this));
        if (amount == 0) revert NothingToWithdraw();
        payToken.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function remaining() external view returns (uint256) {
        return maxSupply - totalMinted;
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return baseTokenURI;
    }
}
`;

const GOOD_STAKING = `${HEADER("staking with rewards over time (the StakingRewards design). People stake a token and earn a reward token every second, in proportion to their stake. The owner funds each reward period; nobody can touch anyone's stake.")}

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

abstract contract GoodStaking is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardsToken;

    /// Seconds one reward period lasts.
    uint256 public duration;
    uint256 public finishAt;
    uint256 public updatedAt;
    /// Reward tokens paid per second, to all stakers together.
    uint256 public rewardRate;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 public totalStaked;
    mapping(address => uint256) public stakedOf;

    error ZeroAmount();
    error ZeroAddress();
    error ZeroDuration();
    error RewardsStillRunning();
    error RewardTooHigh();
    error NotStakingToken();
    error NotEnoughStaked();

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 amount, uint256 finishAt);
    event DurationSet(uint256 duration);

    constructor(IERC20 stakingToken_, IERC20 rewardsToken_, uint256 duration_, address owner_) Ownable(owner_) {
        if (address(stakingToken_) == address(0) || address(rewardsToken_) == address(0)) revert ZeroAddress();
        if (duration_ == 0) revert ZeroDuration();
        stakingToken = stakingToken_;
        rewardsToken = rewardsToken_;
        duration = duration_;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        updatedAt = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(finishAt, block.timestamp);
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (rewardRate * (lastTimeRewardApplicable() - updatedAt) * 1e18) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return (stakedOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18 + rewards[account];
    }

    /// Approve stakingToken for amount first, or send G$ with transferAndCall in one step.
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        _addStake(msg.sender, amount);
    }

    /// G$'s one-step path: gd.transferAndCall(address(this), amount, "") stakes amount.
    function onTokenTransfer(address from, uint256 amount, bytes calldata) external nonReentrant updateReward(from) returns (bool) {
        if (msg.sender != address(stakingToken)) revert NotStakingToken();
        if (amount == 0) revert ZeroAmount();
        _addStake(from, amount);
        return true;
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (stakedOf[msg.sender] < amount) revert NotEnoughStaked();
        stakedOf[msg.sender] -= amount;
        totalStaked -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward == 0) return;
        rewards[msg.sender] = 0;
        rewardsToken.safeTransfer(msg.sender, reward);
        emit RewardPaid(msg.sender, reward);
    }

    /// Takes the whole stake out and claims the rewards.
    function exit() external {
        uint256 all = stakedOf[msg.sender];
        if (all != 0) withdraw(all);
        claim();
    }

    /// Owner: approve rewardsToken for amount first. Starts (or tops up) a reward period of duration seconds.
    function notifyRewardAmount(uint256 amount) external onlyOwner nonReentrant updateReward(address(0)) {
        if (amount == 0) revert ZeroAmount();
        rewardsToken.safeTransferFrom(msg.sender, address(this), amount);
        if (block.timestamp >= finishAt) {
            rewardRate = amount / duration;
        } else {
            rewardRate = (amount + (finishAt - block.timestamp) * rewardRate) / duration;
        }
        if (rewardRate == 0) revert ZeroAmount();
        uint256 available = rewardsToken.balanceOf(address(this));
        if (address(rewardsToken) == address(stakingToken)) available -= totalStaked;
        if (rewardRate * duration > available) revert RewardTooHigh();
        finishAt = block.timestamp + duration;
        updatedAt = block.timestamp;
        emit RewardAdded(amount, finishAt);
    }

    function setDuration(uint256 duration_) external onlyOwner {
        if (finishAt > block.timestamp) revert RewardsStillRunning();
        if (duration_ == 0) revert ZeroDuration();
        duration = duration_;
        emit DurationSet(duration_);
    }

    function _addStake(address user, uint256 amount) private {
        stakedOf[user] += amount;
        totalStaked += amount;
        emit Staked(user, amount);
    }
}
`;

const GOOD_ESCROW = `${HEADER("escrow deals in one ERC-20 such as G$. A payer locks an amount for a payee; the payer (or the arbiter) releases it to the payee; the payee (or the arbiter) can refund it; the payer can take it back after the deadline if it was never released.")}

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract GoodEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Released,
        Refunded
    }

    struct Deal {
        address payer;
        address payee;
        address arbiter;
        uint256 amount;
        uint64 deadline;
        Status status;
    }

    IERC20 public immutable token;
    uint256 public dealCount;
    mapping(uint256 => Deal) private deals;
    mapping(address => uint256[]) private dealsOfUser;

    error ZeroAmount();
    error ZeroAddress();
    error SelfDeal();
    error NotFunded();
    error NotAllowed();
    error DeadlineInPast();

    event DealCreated(uint256 indexed id, address indexed payer, address indexed payee, address arbiter, uint256 amount, uint64 deadline);
    event Released(uint256 indexed id, address indexed by);
    event Refunded(uint256 indexed id, address indexed by);

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    /// Approve token for amount first. arbiter may be address(0) (no arbiter); deadline 0 means none.
    function createDeal(address payee, address arbiter, uint256 amount, uint64 deadline) external nonReentrant returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (payee == address(0)) revert ZeroAddress();
        if (payee == msg.sender || arbiter == msg.sender || arbiter == payee) revert SelfDeal();
        if (deadline != 0 && deadline <= block.timestamp) revert DeadlineInPast();
        id = ++dealCount;
        deals[id] = Deal(msg.sender, payee, arbiter, amount, deadline, Status.Funded);
        dealsOfUser[msg.sender].push(id);
        dealsOfUser[payee].push(id);
        if (arbiter != address(0)) dealsOfUser[arbiter].push(id);
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit DealCreated(id, msg.sender, payee, arbiter, amount, deadline);
    }

    /// The payer or the arbiter pays the payee.
    function release(uint256 id) external nonReentrant {
        Deal storage d = deals[id];
        if (d.status != Status.Funded) revert NotFunded();
        if (msg.sender != d.payer && (d.arbiter == address(0) || msg.sender != d.arbiter)) revert NotAllowed();
        d.status = Status.Released;
        token.safeTransfer(d.payee, d.amount);
        emit Released(id, msg.sender);
    }

    /// The payee or the arbiter returns the money; the payer can take it back once the deadline has passed.
    function refund(uint256 id) external nonReentrant {
        Deal storage d = deals[id];
        if (d.status != Status.Funded) revert NotFunded();
        bool late = d.deadline != 0 && block.timestamp > d.deadline;
        bool allowed = msg.sender == d.payee || (d.arbiter != address(0) && msg.sender == d.arbiter) || (msg.sender == d.payer && late);
        if (!allowed) revert NotAllowed();
        d.status = Status.Refunded;
        token.safeTransfer(d.payer, d.amount);
        emit Refunded(id, msg.sender);
    }

    function getDeal(uint256 id) external view returns (Deal memory) {
        return deals[id];
    }

    function dealsOf(address user) external view returns (uint256[] memory) {
        return dealsOfUser[user];
    }
}
`;

const GOOD_VESTING = `${HEADER("a vesting wallet (OpenZeppelin's VestingWallet) with a cliff. Tokens sent to it unlock for one beneficiary in a straight line from start over duration, nothing before the cliff; the beneficiary calls release(token) to collect what has unlocked.")}

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

abstract contract GoodVesting is VestingWallet {
    /// The moment before which nothing unlocks.
    uint64 public immutable cliff;

    error CliffLongerThanDuration();

    constructor(address beneficiary_, uint64 start_, uint64 duration_, uint64 cliffSeconds_) VestingWallet(beneficiary_, start_, duration_) {
        if (cliffSeconds_ > duration_) revert CliffLongerThanDuration();
        cliff = start_ + cliffSeconds_;
    }

    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp) internal view virtual override returns (uint256) {
        return timestamp < cliff ? 0 : super._vestingSchedule(totalAllocation, timestamp);
    }
}
`;

const GOOD_VOTES_TOKEN = `${HEADER("a voting token (ERC-20 with OpenZeppelin's ERC20Votes) for a DAO. A fixed supply, minted once to the holder. Holders delegate (to themselves or someone else) to vote; votes are counted at the moment a proposal started, so tokens bought later can't swing it. Time is in seconds.")}

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

abstract contract GoodVotesToken is ERC20, ERC20Permit, ERC20Votes {
    error ZeroHolder();

    constructor(string memory name_, string memory symbol_, uint256 supply_, address holder_) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (holder_ == address(0)) revert ZeroHolder();
        _mint(holder_, supply_);
    }

    function clock() public view virtual override returns (uint48) {
        return uint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public view virtual override returns (string memory) {
        return "mode=timestamp";
    }

    function _update(address from, address to, uint256 value) internal virtual override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
`;

const GOOD_GOVERNOR = `${HEADER("a DAO (OpenZeppelin's Governor) voting with a GoodVotesToken. Holders propose, vote For, Against or Abstain, and a proposal that passes its quorum is executed by the DAO itself, which can hold and send funds. Times are in seconds.")}

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

abstract contract GoodGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction {
    /// votingDelay_ and votingPeriod_ in seconds; quorumPercent_ of all votes must take part (For + Abstain).
    constructor(string memory name_, IVotes token_, uint48 votingDelay_, uint32 votingPeriod_, uint256 proposalThreshold_, uint256 quorumPercent_)
        Governor(name_)
        GovernorSettings(votingDelay_, votingPeriod_, proposalThreshold_)
        GovernorVotes(token_)
        GovernorVotesQuorumFraction(quorumPercent_)
    {}

    function votingDelay() public view virtual override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view virtual override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function quorum(uint256 timepoint) public view virtual override(Governor, GovernorVotesQuorumFraction) returns (uint256) {
        return super.quorum(timepoint);
    }

    function proposalThreshold() public view virtual override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }
}
`;

const GOOD_POLL = `${HEADER("polls where each wallet votes once. A poll has a question, 2 to 10 choices and an end time; votes are public and final. Creating polls is open to anyone, or to the owner only.")}

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

abstract contract GoodPoll is Ownable2Step {
    struct Poll {
        address creator;
        uint64 endsAt;
        uint8 choices;
        string question;
    }

    uint256 public constant MAX_CHOICES = 10;
    uint256 public constant MAX_QUESTION = 280;

    /// When false, only the owner creates polls.
    bool public immutable anyoneCanCreate;
    uint256 public pollCount;
    mapping(uint256 => Poll) private polls;
    mapping(uint256 => mapping(uint256 => uint256)) public votesFor;
    mapping(uint256 => mapping(address => uint256)) private choicePlusOne;

    error BadChoices();
    error QuestionTooLong();
    error EndInPast();
    error NoSuchPoll();
    error PollClosed();
    error AlreadyVoted();
    error NotAllowed();

    event PollCreated(uint256 indexed id, address indexed creator, string question, uint8 choices, uint64 endsAt);
    event Voted(uint256 indexed id, address indexed voter, uint8 choice);

    constructor(bool anyoneCanCreate_, address owner_) Ownable(owner_) {
        anyoneCanCreate = anyoneCanCreate_;
    }

    function createPoll(string calldata question, uint8 choices, uint64 endsAt) external returns (uint256 id) {
        if (!anyoneCanCreate && msg.sender != owner()) revert NotAllowed();
        if (choices < 2 || choices > MAX_CHOICES) revert BadChoices();
        if (bytes(question).length == 0 || bytes(question).length > MAX_QUESTION) revert QuestionTooLong();
        if (endsAt <= block.timestamp) revert EndInPast();
        id = ++pollCount;
        polls[id] = Poll(msg.sender, endsAt, choices, question);
        emit PollCreated(id, msg.sender, question, choices, endsAt);
    }

    /// choice is 0-based.
    function vote(uint256 id, uint8 choice) external {
        Poll storage p = polls[id];
        if (p.choices == 0) revert NoSuchPoll();
        if (block.timestamp >= p.endsAt) revert PollClosed();
        if (choice >= p.choices) revert BadChoices();
        if (choicePlusOne[id][msg.sender] != 0) revert AlreadyVoted();
        choicePlusOne[id][msg.sender] = uint256(choice) + 1;
        votesFor[id][choice] += 1;
        emit Voted(id, msg.sender, choice);
    }

    function getPoll(uint256 id) external view returns (Poll memory) {
        return polls[id];
    }

    /// Every choice's count, in order.
    function results(uint256 id) external view returns (uint256[] memory counts) {
        uint8 n = polls[id].choices;
        counts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) counts[i] = votesFor[id][i];
    }

    function hasVoted(uint256 id, address voter) external view returns (bool) {
        return choicePlusOne[id][voter] != 0;
    }

    /// The voter's choice, or -1 if they haven't voted.
    function choiceOf(uint256 id, address voter) external view returns (int256) {
        return int256(choicePlusOne[id][voter]) - 1;
    }
}
`;

const GOOD_SAVINGS = `${HEADER("savings goals in one ERC-20 such as G$. Each person makes goals with a target and an optional unlock date; anyone can add to a goal (a gift), and only its owner can take money out, after the unlock date. Nobody else, the deployer included, can move anyone's savings.")}

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract GoodSavings is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Goal {
        address owner;
        uint64 unlockAt;
        uint256 target;
        uint256 saved;
        string name;
    }

    uint256 public constant MAX_NAME = 64;

    IERC20 public immutable token;
    uint256 public goalCount;
    mapping(uint256 => Goal) private goals;
    mapping(address => uint256[]) private goalsOfUser;

    error ZeroAmount();
    error ZeroAddress();
    error BadName();
    error NoSuchGoal();
    error NotGoalOwner();
    error StillLocked();
    error NotEnoughSaved();
    error NotSavingsToken();

    event GoalCreated(uint256 indexed id, address indexed owner, string name, uint256 target, uint64 unlockAt);
    event Deposited(uint256 indexed id, address indexed from, uint256 amount);
    event Withdrawn(uint256 indexed id, address indexed owner, uint256 amount);

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    /// target 0 means no target; unlockAt 0 means the money can come out any time.
    function createGoal(string calldata name, uint256 target, uint64 unlockAt) external returns (uint256 id) {
        if (bytes(name).length == 0 || bytes(name).length > MAX_NAME) revert BadName();
        id = ++goalCount;
        goals[id] = Goal(msg.sender, unlockAt, target, 0, name);
        goalsOfUser[msg.sender].push(id);
        emit GoalCreated(id, msg.sender, name, target, unlockAt);
    }

    /// Approve token for amount first, or use G$'s one step: gd.transferAndCall(address(this), amount, abi.encode(id)).
    function deposit(uint256 id, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (goals[id].owner == address(0)) revert NoSuchGoal();
        token.safeTransferFrom(msg.sender, address(this), amount);
        _credit(id, msg.sender, amount);
    }

    function onTokenTransfer(address from, uint256 amount, bytes calldata data) external nonReentrant returns (bool) {
        if (msg.sender != address(token)) revert NotSavingsToken();
        if (amount == 0) revert ZeroAmount();
        uint256 id = abi.decode(data, (uint256));
        if (goals[id].owner == address(0)) revert NoSuchGoal();
        _credit(id, from, amount);
        return true;
    }

    function withdraw(uint256 id, uint256 amount) external nonReentrant {
        Goal storage g = goals[id];
        if (g.owner != msg.sender) revert NotGoalOwner();
        if (block.timestamp < g.unlockAt) revert StillLocked();
        if (amount == 0) revert ZeroAmount();
        if (g.saved < amount) revert NotEnoughSaved();
        g.saved -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(id, msg.sender, amount);
    }

    function getGoal(uint256 id) external view returns (Goal memory) {
        return goals[id];
    }

    function goalsOf(address user) external view returns (uint256[] memory) {
        return goalsOfUser[user];
    }

    function _credit(uint256 id, address from, uint256 amount) private {
        goals[id].saved += amount;
        emit Deposited(id, from, amount);
    }
}
`;

const TEST_LINE = `Test it in contracts/test/<Name>.t.sol (read_guide "contract-tests"): deploy your child contract in setUp(), then test the flows this app uses and the guards that matter to it. The template itself is already tested, so keep it short: 3 to 5 tests.`;

export const TEMPLATES: ContractTemplate[] = [
  {
    id: "token",
    label: "an ERC-20 coin with a fixed supply (GoodToken)",
    match: /\b(erc-?20|token|coin)\b/i,
    files: { "GoodToken.sol": GOOD_TOKEN },
    guide: `GoodToken (contracts/goodbuild/GoodToken.sol): constructor(string name_, string symbol_, uint256 supply_, address holder_). Inherits OpenZeppelin ERC20, ERC20Burnable and ERC20Permit; the whole supply is minted once to holder_.
  import {GoodToken} from "./goodbuild/GoodToken.sol";
  contract RTXToken is GoodToken {
      constructor() GoodToken("Rotex", "RTX", 50_000_000e18, msg.sender) {}
  }`,
  },
  {
    id: "nft",
    label: "an ERC-721 collection, free or paid in G$ (GoodNFT)",
    match: /\b(nft|erc-?721|collectible|collection|badge|ticket|membership card|art)\b/i,
    files: { "GoodNFT.sol": GOOD_NFT },
    guide: `GoodNFT (contracts/goodbuild/GoodNFT.sol): constructor(string name_, string symbol_, IERC20 payToken_, uint256 price_, uint256 maxSupply_, uint256 maxPerWallet_, string baseURI_, address owner_). price_ 0 with payToken_ IERC20(address(0)) is a free mint. Functions: mint() (approve payToken for price first), setBaseURI, withdraw(to) (owner), remaining(), totalMinted, mintedBy(user), plus all of ERC-721.
  import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
  import {GoodNFT} from "./goodbuild/GoodNFT.sol";
  contract CityPass is GoodNFT {
      constructor(IERC20 gd_) GoodNFT("City Pass", "PASS", gd_, 10e18, 500, 2, "https://example.org/pass/", msg.sender) {}
  }
  Override tokenURI only if every token shares one picture.`,
  },
  {
    id: "staking",
    label: "staking that pays rewards over time (GoodStaking)",
    match: /\b(stak\w*|yield|farm\w*|reward\w*)\b/i,
    files: { "GoodStaking.sol": GOOD_STAKING },
    guide: `GoodStaking (contracts/goodbuild/GoodStaking.sol): constructor(IERC20 stakingToken_, IERC20 rewardsToken_, uint256 duration_, address owner_). The same token can be both (stake G$, earn G$). Functions: stake(amount) (approve first) or G$'s one step gd.transferAndCall(staking, amount, ""), withdraw(amount), claim(), exit(), earned(user), stakedOf(user), totalStaked, rewardRate, finishAt; the owner calls notifyRewardAmount(amount) (approve first) to fund a period of duration seconds, and setDuration between periods.
  import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
  import {GoodStaking} from "./goodbuild/GoodStaking.sol";
  contract GDStaking is GoodStaking {
      constructor(IERC20 gd_) GoodStaking(gd_, gd_, 30 days, msg.sender) {}
  }
  Tests have no clock control, so test stake, withdraw, the owner-only funding and the reward guard, not reward amounts over time.`,
  },
  {
    id: "escrow",
    label: "escrow deals with an optional arbiter (GoodEscrow)",
    match: /\b(escrow|deal|milestone payment|freelanc\w*|marketplace|hold\w* funds|release)\b/i,
    files: { "GoodEscrow.sol": GOOD_ESCROW },
    guide: `GoodEscrow (contracts/goodbuild/GoodEscrow.sol): constructor(IERC20 token_). Functions: createDeal(payee, arbiter, amount, deadline) returns id (approve first; arbiter address(0) for none, deadline 0 for none), release(id) (payer or arbiter), refund(id) (payee or arbiter, or the payer after the deadline), getDeal(id) returns (payer, payee, arbiter, amount, deadline, status 0 none 1 funded 2 released 3 refunded), dealsOf(user), dealCount.
  import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
  import {GoodEscrow} from "./goodbuild/GoodEscrow.sol";
  contract GigEscrow is GoodEscrow {
      constructor(IERC20 gd_) GoodEscrow(gd_) {}
  }`,
  },
  {
    id: "vesting",
    label: "a vesting wallet with a cliff (GoodVesting)",
    match: /\b(vest\w*|cliff|unlock schedule|team tokens)\b/i,
    files: { "GoodVesting.sol": GOOD_VESTING },
    guide: `GoodVesting (contracts/goodbuild/GoodVesting.sol): constructor(address beneficiary_, uint64 start_, uint64 duration_, uint64 cliffSeconds_). One wallet per beneficiary: send tokens to it, and they unlock in a straight line from start over duration, nothing before the cliff. Functions (OpenZeppelin VestingWallet): release(token) (anyone; pays the beneficiary), releasable(token), released(token), vestedAmount(token, timestamp), start(), duration(), end(), owner() (the beneficiary), cliff.
  import {GoodVesting} from "./goodbuild/GoodVesting.sol";
  contract TeamVesting is GoodVesting {
      constructor(address beneficiary_) GoodVesting(beneficiary_, uint64(block.timestamp), 365 days, 90 days) {}
  }
  In contracts/deploy.json, the beneficiary is a constructor argument, usually "\${DEPLOYER}" unless the person gave an address.`,
  },
  {
    id: "governance",
    label: "a DAO with a voting token: proposals, votes, quorum, execution (GoodGovernor and GoodVotesToken)",
    match: /\b(dao|governance|governor|proposal\w*|treasury|delegat\w*)\b/i,
    files: { "GoodVotesToken.sol": GOOD_VOTES_TOKEN, "GoodGovernor.sol": GOOD_GOVERNOR },
    guide: `A DAO is two contracts.
  GoodVotesToken (contracts/goodbuild/GoodVotesToken.sol): constructor(string name_, string symbol_, uint256 supply_, address holder_). An ERC-20 with votes; holders call delegate(themselves) once before their tokens count. Time is in seconds.
  GoodGovernor (contracts/goodbuild/GoodGovernor.sol): constructor(string name_, IVotes token_, uint48 votingDelay_, uint32 votingPeriod_, uint256 proposalThreshold_, uint256 quorumPercent_), times in seconds. OpenZeppelin Governor: propose(targets, values, calldatas, description) returns proposalId, castVote(proposalId, support) with support 0 Against, 1 For, 2 Abstain, state(proposalId) (0 Pending, 1 Active, 2 Canceled, 3 Defeated, 4 Succeeded, 5 Queued, 6 Expired, 7 Executed), proposalVotes(proposalId) returns (against, for, abstain), hasVoted(proposalId, account), execute(targets, values, calldatas, keccak256(bytes(description))), proposalDeadline, quorum(timepoint), getVotes(account, timepoint).
  import {GoodVotesToken} from "./goodbuild/GoodVotesToken.sol";
  import {GoodGovernor} from "./goodbuild/GoodGovernor.sol";
  import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
  contract ClubToken is GoodVotesToken {
      constructor() GoodVotesToken("Club Vote", "CLUB", 1_000_000e18, msg.sender) {}
  }
  contract ClubDAO is GoodGovernor {
      constructor(IVotes token_) GoodGovernor("Club DAO", token_, 1, 3 days, 0, 4) {}
  }
  Put each in its own file (contracts/ClubToken.sol, contracts/ClubDAO.sol); in contracts/deploy.json the DAO takes "\${ClubToken.address}". Tests have no clock control: test delegation, that a proposal can be made, and that a vote before it opens fails.`,
  },
  {
    id: "poll",
    label: "simple polls, one vote per wallet (GoodPoll)",
    match: /\b(poll\w*|vote|voting|ballot|survey|election)\b/i,
    files: { "GoodPoll.sol": GOOD_POLL },
    guide: `GoodPoll (contracts/goodbuild/GoodPoll.sol): constructor(bool anyoneCanCreate_, address owner_). Functions: createPoll(question, choices 2 to 10, endsAt) returns id, vote(id, choice) (0-based, once per wallet, before endsAt), getPoll(id) returns (creator, endsAt, choices, question), results(id) returns uint256[] counts, hasVoted(id, voter), choiceOf(id, voter) (-1 if none), votesFor(id, choice), pollCount. The choices' labels are app data (src/lib/db.ts) or fixed in the page; the contract counts by number.
  import {GoodPoll} from "./goodbuild/GoodPoll.sol";
  contract ClassPoll is GoodPoll {
      constructor() GoodPoll(true, msg.sender) {}
  }
  For token-weighted votes with proposals that move funds, use the governance template instead.`,
  },
  {
    id: "savings",
    label: "savings goals in G$ (GoodSavings)",
    match: /\b(saving\w*|savings|piggy ?bank|save up|put aside)\b/i,
    files: { "GoodSavings.sol": GOOD_SAVINGS },
    guide: `GoodSavings (contracts/goodbuild/GoodSavings.sol): constructor(IERC20 token_). Functions: createGoal(name up to 64 bytes, target (0 for none), unlockAt (0 for any time)) returns id, deposit(id, amount) (approve first; anyone can add to any goal) or G$'s one step gd.transferAndCall(savings, amount, abi.encode(id)), withdraw(id, amount) (the goal's owner, after unlockAt), getGoal(id) returns (owner, unlockAt, target, saved, name), goalsOf(user) returns ids, goalCount.
  import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
  import {GoodSavings} from "./goodbuild/GoodSavings.sol";
  contract GoalSavings is GoodSavings {
      constructor(IERC20 gd_) GoodSavings(gd_) {}
  }`,
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));
/** The templates' own contract names (GoodToken, GoodSavings, ...), which an app's contract can't take. */
export const TEMPLATE_CONTRACTS: string[] = TEMPLATES.flatMap((t) => Object.keys(t.files).map((f) => f.replace(/\.sol$/, "")));
/** The most specific words first: "a token-gated NFT" is an NFT, "a DAO's voting token" is governance. */
const MATCH_ORDER: TemplateId[] = ["governance", "nft", "staking", "escrow", "vesting", "savings", "poll", "token"];

export function templateById(id: string): ContractTemplate | undefined {
  return BY_ID.get(id as TemplateId);
}

/** Project paths for a template's files. */
export function templateFiles(t: ContractTemplate): Record<string, string> {
  return Object.fromEntries(Object.entries(t.files).map(([name, body]) => [`${TEMPLATE_DIR}${name}`, body]));
}

export function isTemplatePath(path: string): boolean {
  return path.startsWith(TEMPLATE_DIR);
}

export const TEMPLATE_REFUSAL = `${TEMPLATE_DIR} holds GoodBuild's audited contract templates. Don't change them: inherit one in your own contract (contracts/<Name>.sol) and set its values in the constructor. To change how it behaves, override one of its virtual functions in your contract.`;

/**
 * The templates for a spec's contracts: the one each contract names, or else the first whose words match its
 * name and purpose. A contract the planner marked "none" (custom logic, such as a game's shop) gets none.
 */
export function templatesFor(spec: Pick<AppSpec, "contracts">): ContractTemplate[] {
  const picked = new Map<TemplateId, ContractTemplate>();
  for (const c of spec.contracts) {
    const named = c.template;
    if (named === "none") continue;
    const t = named ? templateById(named) : MATCH_ORDER.map((id) => BY_ID.get(id)!).find((x) => x.match.test(`${c.name} ${c.purpose}`));
    if (t) picked.set(t.id, t);
  }
  // A DAO's token has to carry votes: the governance template brings its own (GoodVotesToken), and a plain
  // GoodToken beside it would be the wrong base (seen live: the planner marked the DAO's coin "token").
  if (picked.has("governance")) picked.delete("token");
  return [...picked.values()];
}

/** The planner's menu, for the spec request. */
export function templateMenu(): string {
  return TEMPLATES.map((t) => `${t.id}: ${t.label}`).join("; ");
}

/** What the contracts phase is told about the templates it has. */
export function templatesBrief(templates: ContractTemplate[]): string {
  if (!templates.length) return "";
  return `GoodBuild's audited templates are in the project for this app. Inherit them; don't write token, NFT, staking, escrow, vesting, voting or savings logic yourself, and don't copy their code. Your contract only passes its values to the template's constructor, and adds what the app needs on top (an extra view, an event, a function that calls the template's internal parts). Never change contracts/goodbuild/.

${templates.map((t) => t.guide).join("\n\n")}

${TEST_LINE}`;
}
