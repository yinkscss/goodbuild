import { STABLECOINS } from "@/config/stablecoins";

import type { Kit } from "./registry";

/**
 * The leaderboard contract for MiniPay games (D92). MiniPay allows no sign-in signature, so a game
 * there can't prove a wallet to GoodBuild's saved data. The owner chose a hybrid: browsers sign once
 * and save to app data, and MiniPay posts each best score to this small contract for a dollar fee.
 * useLeaderboard (src/game/leaderboard.ts) shows both as one board.
 *
 * It's a kit of its own because a contract means a deploy: only games that have a leaderboard and
 * work in MiniPay get it. The runner turns it on from the plan's answers.
 */

const GAME_BOARD_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A game's leaderboard: each wallet's best score and the top 25, highest first.
/// Scores come from the player's own device, so this proves who posted a score, not that it was earned.
/// Never pay prizes from it without an organiser checking the results.
contract GameBoard {
    struct Entry {
        address player;
        uint64 score;
        string name;
    }

    uint256 public constant SIZE = 25;
    uint256 public constant MAX_NAME = 24;

    mapping(address => uint64) public best;
    mapping(address => string) public nameOf;
    /// Highest first, at most SIZE.
    address[] private ranked;

    event ScorePosted(address indexed player, uint64 score, string name);

    error EmptyName();
    error NameTooLong();
    error NotABest(uint64 best);

    /// Post a score for the caller. Only a new best counts.
    function submit(uint64 score, string calldata name) external {
        uint256 length = bytes(name).length;
        if (length == 0) revert EmptyName();
        if (length > MAX_NAME) revert NameTooLong();
        if (score <= best[msg.sender]) revert NotABest(best[msg.sender]);
        best[msg.sender] = score;
        nameOf[msg.sender] = name;
        emit ScorePosted(msg.sender, score, name);
        _place(msg.sender, score);
    }

    function _place(address player, uint64 score) private {
        uint256 n = ranked.length;
        uint256 at = n;
        for (uint256 i = 0; i < n; i++) {
            if (ranked[i] == player) {
                at = i;
                break;
            }
        }
        if (at == n) {
            if (n < SIZE) {
                ranked.push(player);
            } else if (score > best[ranked[n - 1]]) {
                at = n - 1;
            } else {
                return;
            }
        }
        // Move up past everyone with a lower best. A tie keeps whoever got there first ahead.
        while (at > 0 && best[ranked[at - 1]] < score) {
            ranked[at] = ranked[at - 1];
            at--;
        }
        ranked[at] = player;
    }

    function top() external view returns (Entry[] memory list) {
        list = new Entry[](ranked.length);
        for (uint256 i = 0; i < ranked.length; i++) {
            address p = ranked[i];
            list[i] = Entry(p, best[p], nameOf[p]);
        }
    }

    function count() external view returns (uint256) {
        return ranked.length;
    }
}
`;

const GAME_BOARD_TEST = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Actor} from "@goodbuild/Test.sol";
import {GameBoard} from "../GameBoard.sol";

contract GameBoardTest is Test {
    GameBoard board;

    function setUp() public {
        board = new GameBoard();
    }

    function post(Actor who, uint64 score) internal {
        who.exec(address(board), abi.encodeCall(board.submit, (score, "Ada")));
    }

    function testRanksHighestFirst() public {
        Actor a = newActor();
        Actor b = newActor();
        Actor c = newActor();
        post(a, 10);
        post(b, 30);
        post(c, 20);
        GameBoard.Entry[] memory list = board.top();
        assertEq(list.length, 3, "three on the board");
        assertEq(list[0].player, address(b), "the best is first");
        assertEq(list[1].player, address(c), "then the next");
        assertEq(list[2].player, address(a), "then the lowest");
        post(a, 40);
        assertEq(board.top()[0].player, address(a), "a new best moves up");
        assertEq(board.count(), 3, "still one row per player");
    }

    function testOnlyABestCounts() public {
        Actor a = newActor();
        post(a, 50);
        expectRevert(a, address(board), abi.encodeCall(board.submit, (40, "Ada")), "a lower score is refused");
        expectRevert(a, address(board), abi.encodeCall(board.submit, (50, "Ada")), "the same score is refused");
        assertEq(board.best(address(a)), 50, "the best is kept");
    }

    function testNameRules() public {
        Actor a = newActor();
        expectRevert(a, address(board), abi.encodeCall(board.submit, (1, "")), "a name is needed");
        expectRevert(a, address(board), abi.encodeCall(board.submit, (1, "abcdefghijklmnopqrstuvwxy")), "25 characters is too long");
        a.exec(address(board), abi.encodeCall(board.submit, (1, "abcdefghijklmnopqrstuvwx")));
        assertEq(board.best(address(a)), 1, "24 characters is fine");
    }

    function testKeepsTheTop25() public {
        for (uint64 i = 1; i <= 30; i++) post(newActor(), i);
        GameBoard.Entry[] memory list = board.top();
        assertEq(list.length, 25, "25 rows at most");
        assertEq(list[0].score, 30, "the best is first");
        assertEq(list[24].score, 6, "the lowest five fell off");
        Actor late = newActor();
        post(late, 3);
        assertEq(board.top()[24].score, 6, "a score below the board doesn't get on");
    }

    function testExploitUnauthorizedCall() public {
        Actor alice = newActor();
        Actor mallory = newActor();
        post(alice, 100);
        post(mallory, 5);
        assertEq(board.best(address(alice)), 100, "nobody can lower someone else's best");
        assertEq(board.top()[0].player, address(alice), "nobody can push someone else down");
    }
}
`;

/** Dollar coins that can pay Celo's network fee, per network: address, decimals and the fee-currency address. */
const FEE_COINS = JSON.stringify(
  Object.fromEntries(Object.entries(STABLECOINS).map(([chainId, coins]) => [chainId, Object.values(coins).map((c) => ({ symbol: c.symbol, address: c.address, decimals: c.decimals, feeCurrency: c.feeCurrency }))])),
  null,
  2,
);

const CHAIN_BOARD = `import { createWalletClient, custom, erc20Abi, type Abi, type Address } from "viem";

import { chain, connectWallet, publicClient, walletProvider } from "../lib/chain";
import { isMiniPay } from "../lib/goodbuild/wallet";
import type { BoardEntry, ChainBoard } from "./leaderboard";

/** The dollar coins that can pay the network fee, per network. */
const FEE_COINS: Record<string, { symbol: string; address: string; decimals: number; feeCurrency: string }[]> = ${FEE_COINS};

/**
 * The leaderboard contract (contracts/GameBoard.sol) for useLeaderboard. Undefined until the contract
 * is deployed on this network. Make it once, at module level:
 *   import { GameBoardAbi, GameBoardAddress } from "../contracts";
 *   import { chain } from "../lib/chain";
 *   const miniPayBoard = gameBoard(GameBoardAbi, GameBoardAddress[chain.id]);
 *   const board = useLeaderboard({ chain: miniPayBoard });
 * Inside MiniPay it posts scores, paying the network fee in whichever dollar coin the player has.
 * Elsewhere it is only read, so browser players see MiniPay players' scores too.
 */
export function gameBoard(abi: Abi | readonly unknown[], address: Address | undefined): ChainBoard | undefined {
  if (!address) return undefined;
  return {
    id: address,
    canSubmit: isMiniPay(),
    async top(): Promise<BoardEntry[]> {
      const rows = (await publicClient.readContract({ address, abi, functionName: "top" } as never)) as readonly { player: Address; score: bigint; name: string }[];
      return rows.map((r) => ({ wallet: r.player.toLowerCase(), name: r.name, score: Number(r.score) }));
    },
    async submit(name: string, score: number): Promise<boolean> {
      const account = await connectWallet();
      const best = (await publicClient.readContract({ address, abi, functionName: "best", args: [account] } as never)) as bigint;
      if (BigInt(score) <= best) return false;
      const feeCurrency = await feeCoin(account);
      const wallet = createWalletClient({ account, chain, transport: custom(walletProvider()!) });
      const hash = await wallet.writeContract({
        address,
        abi,
        functionName: "submit",
        args: [BigInt(score), name.slice(0, 24)],
        feeCurrency,
        type: "legacy",
      } as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The score wasn't saved. Nothing was charged except the network fee. Please try again.");
      return true;
    },
  };
}

/** The fee-currency address of the first dollar coin this wallet has a few cents of. */
async function feeCoin(owner: Address): Promise<Address> {
  for (const coin of FEE_COINS[String(chain.id)] ?? []) {
    try {
      const balance = (await publicClient.readContract({ address: coin.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [owner] } as never)) as bigint;
      if (balance >= 10n ** BigInt(coin.decimals) / 100n) return coin.feeCurrency as Address;
    } catch {
      /* this coin can't be read here: try the next */
    }
  }
  throw new Error("Posting a score needs a few cents in USDm, USDT or USDC for the network fee. Add cash and try again.");
}
`;

const GUIDE = `The MiniPay leaderboard contract. This game has a leaderboard and works in MiniPay, and MiniPay allows no sign-in signature, so scores from MiniPay go to a small contract.
- contracts/GameBoard.sol and contracts/test/GameBoard.t.sol are written and tested. Don't change them, and don't write another leaderboard contract.
- In the game: import { GameBoardAbi, GameBoardAddress } from "./contracts" and { chain } from "./lib/chain" (the paths from the file you're in), make const miniPayBoard = gameBoard(GameBoardAbi, GameBoardAddress[chain.id]) ONCE at module level (gameBoard is in src/game/chainBoard.ts), and pass it: useLeaderboard({ chain: miniPayBoard }). Browser players still post through saved data; MiniPay players post here; the board shows both.
- Until the owner deploys the contract, gameBoard returns undefined and MiniPay players see "The leaderboard isn't open in MiniPay yet". Tell the owner in your reply that the leaderboard needs one deploy for MiniPay.`;

export const gameBoard: Kit = {
  id: "game-board",
  title: "MiniPay leaderboard contract",
  when: "a game with a leaderboard that must work inside MiniPay (GoodBuild turns it on from the plan)",
  keywords: /\b(on-?chain|onchain) (leader ?board|high ?scores?)\b/i,
  packages: {},
  files: {
    "contracts/GameBoard.sol": GAME_BOARD_SOL,
    "contracts/test/GameBoard.t.sol": GAME_BOARD_TEST,
    "src/game/chainBoard.ts": CHAIN_BOARD,
  },
  guide: GUIDE,
};
