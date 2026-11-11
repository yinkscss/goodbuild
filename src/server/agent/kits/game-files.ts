/**
 * More of the 2D game kit's starter files (D93): one drawing shown outside the game, and a
 * leaderboard that works the first time, in a browser and inside MiniPay. Kept beside game-2d.ts so
 * that file stays readable.
 */

export const SPRITE = `import { useEffect, useRef, type CSSProperties } from "react";

/**
 * A game drawing outside the game: a car in the garage, a skin in the store, the player's ship next
 * to their name on the leaderboard. Write each thing's drawing once, as a function that draws into a
 * box (drawCar(ctx, x, y, w, h, colour)), call it in the game's onFrame, and show it here with
 *   <Sprite draw={(ctx, w, h) => drawCar(ctx, 0, 0, w, h, "#e11d48")} width={96} height={128} label="Red racer" />
 * so the store shows exactly what the game draws, sharp at any screen density.
 */
export function Sprite({
  draw,
  width = 96,
  height = width,
  label,
  className,
  style,
}: {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  width?: number;
  height?: number;
  /** What a screen reader calls the picture. Leave it out when the text next to it says the same. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
  }, [draw, width, height]);
  return (
    <canvas
      ref={ref}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{ display: "inline-block", width, height, flexShrink: 0, ...style }}
    />
  );
}
`;

export const LEADERBOARD_TS = `import { useCallback, useEffect, useRef, useState } from "react";

import { collection, currentWallet, signIn } from "../lib/db";
import { errorMessage } from "../lib/format";
import { isMiniPay, subscribeWallet, walletState } from "../lib/goodbuild/wallet";

/**
 * The game's leaderboard. Playing is free and needs no wallet; only posting a score does.
 * - In a browser, posting connects the wallet and asks for one free signature (no fee), then saves
 *   the wallet's best in this app's saved data, in the "scores" collection. Its rule must be in
 *   src/lib/dataRules.json exactly as SCORES_RULE below.
 * - Inside MiniPay, which allows no sign-in signature, a score is posted to the leaderboard contract
 *   instead (contracts/GameBoard.sol, with chainBoard from src/game/chainBoard.ts), for a small
 *   network fee in dollars.
 * The board shows both, one row per wallet. Scores come from players' own devices: say so on the page.
 */

/** The rule for src/lib/dataRules.json, under "collections": "scores": SCORES_RULE. */
export const SCORES_RULE = {
  create: "signed-in",
  read: ["anyone"],
  fields: { name: "string", score: "number", extra: "string" },
} as const;

export interface BoardEntry {
  /** Lowercase wallet address. */
  wallet: string;
  name: string;
  score: number;
  /** Anything small the game keeps with a score, such as the car or level. */
  extra?: string;
}

/** A leaderboard kept by a contract. Make it once (module level or useMemo), not on every render. */
export interface ChainBoard {
  /** Tells boards apart: the contract's address. */
  id: string;
  /** True where scores are posted to the contract (inside MiniPay). Elsewhere the contract is only read. */
  canSubmit: boolean;
  top(): Promise<BoardEntry[]>;
  /** Posts the score. Resolves false when it isn't above this wallet's best, so nothing was sent. */
  submit(name: string, score: number): Promise<boolean>;
}

interface ScoreValue {
  name: string;
  score: number;
  extra?: string;
}

export type PostResult = "saved" | "not-best" | "cancelled" | "failed";

const NAME_KEY = "board:name";

/** A name that is safe to show: no control characters or angle brackets, at most 20 characters. */
export function cleanName(text: string): string {
  return text.replace(/[\\u0000-\\u001f\\u007f<>]/g, "").replace(/\\s+/g, " ").trim().slice(0, 20);
}

/** The name this player used last time on this device. */
export function savedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The best score per wallet, highest first. */
function merge(entries: BoardEntry[], size: number): BoardEntry[] {
  const best = new Map<string, BoardEntry>();
  for (const e of entries) {
    const had = best.get(e.wallet);
    if (!had || e.score > had.score) best.set(e.wallet, e);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, size);
}

const cancelled = (e: unknown) => (e as { code?: unknown })?.code === 4001 || /user (rejected|denied)|rejected the request/i.test(String((e as Error)?.message ?? e));

/**
 * const board = useLeaderboard({ chain: miniPayBoard });
 * board.top (highest first), board.mine (this wallet's row), board.loading, board.error, board.retry(),
 * await board.post(name, score, extra) after a game over. Show it with <Leaderboard board={board} />
 * and <PostScore board={board} score={score} /> from src/game/Leaderboard.tsx.
 */
export function useLeaderboard(options: { collection?: string; chain?: ChainBoard; size?: number } = {}) {
  const name = options.collection ?? "scores";
  const size = Math.max(1, Math.min(options.size ?? 10, 50));
  const chainRef = useRef(options.chain);
  chainRef.current = options.chain;
  const chainId = options.chain?.id ?? "";
  const [top, setTop] = useState<BoardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [account, setAccount] = useState<string | null>(() => walletState().account?.toLowerCase() ?? null);
  useEffect(() => subscribeWallet(() => setAccount(walletState().account?.toLowerCase() ?? null)), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const chain = chainRef.current;
      const [saved, onChain] = await Promise.all([
        collection<ScoreValue>(name)
          .list({ orderBy: "score", dir: "desc", limit: Math.min(size * 2, 100) })
          .then((page) =>
            page.records
              .filter((r) => r.owner?.startsWith("0x"))
              .map((r) => ({
                wallet: r.owner!.toLowerCase(),
                name: cleanName(String(r.value?.name ?? "")) || "Player",
                score: Math.max(0, Number(r.value?.score) || 0),
                ...(typeof r.value?.extra === "string" ? { extra: r.value.extra } : {}),
              })),
          ),
        // A contract that can't be read (not deployed here, no network) leaves the saved scores showing.
        chain ? chain.top().catch(() => [] as BoardEntry[]) : Promise.resolve([] as BoardEntry[]),
      ]);
      setTop(merge([...saved, ...onChain], size));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [name, size, chainId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Post a finished run. Asks for the wallet when needed. Never throws: read the result and board.error. */
  const post = useCallback(
    async (playerName: string, score: number, extra?: string): Promise<PostResult> => {
      const clean = cleanName(playerName) || "Player";
      const value = Math.max(0, Math.floor(score));
      try {
        window.localStorage.setItem(NAME_KEY, clean);
      } catch {
        /* storage is blocked: the name just isn't remembered */
      }
      setPosting(true);
      setError(null);
      try {
        if (isMiniPay()) {
          const chain = chainRef.current;
          if (!chain?.canSubmit) throw new Error("The leaderboard isn't open in MiniPay yet. Its owner needs to deploy it first.");
          if (!(await chain.submit(clean, value))) return "not-best";
        } else {
          // One free signature proves the wallet is theirs. A different wallet than the one signed in signs again.
          const account = walletState().account?.toLowerCase();
          let wallet = await currentWallet().catch(() => null);
          if (!wallet || (account && wallet.toLowerCase() !== account)) wallet = await signIn();
          const store = collection<ScoreValue>(name);
          const mine = await store.get("best");
          if (mine && Number(mine.value?.score) >= value) return "not-best";
          await store.put("best", extra === undefined ? { name: clean, score: value } : { name: clean, score: value, extra: String(extra).slice(0, 200) });
        }
        await load();
        return "saved";
      } catch (e) {
        if (cancelled(e)) return "cancelled";
        setError(errorMessage(e));
        return "failed";
      } finally {
        setPosting(false);
      }
    },
    [name, load],
  );

  const mine = account ? top.find((e) => e.wallet === account) : undefined;
  return { top, mine, account, loading, error, posting, post, retry: load, inMiniPay: isMiniPay() };
}

export type LeaderboardState = ReturnType<typeof useLeaderboard>;
`;

export const LEADERBOARD_TSX = `import { useState, type ReactNode } from "react";
import { Trophy } from "lucide-react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { shortAddress } from "../lib/utils";
import { savedName, type BoardEntry, type LeaderboardState, type PostResult } from "./leaderboard";

/**
 * The top of the board: loading, empty, failed with Retry, and "You" on the player's own row.
 * icon draws something small next to each name (their car, from the game's own drawing, with Sprite).
 */
export function Leaderboard({
  board,
  title = "Leaderboard",
  icon,
  className = "",
}: {
  board: LeaderboardState;
  title?: string;
  icon?: (entry: BoardEntry) => ReactNode;
  className?: string;
}) {
  return (
    <section className={"rounded-xl border border-border bg-card p-4 " + className} aria-labelledby="board-title">
      <h2 id="board-title" className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Trophy className="size-4 text-accent" aria-hidden />
        {title}
      </h2>
      {board.loading && !board.top.length ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : board.error && !board.top.length ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">The leaderboard didn't load. {board.error}</p>
          <Button size="sm" variant="outline" onClick={() => void board.retry()}>
            Try again
          </Button>
        </div>
      ) : !board.top.length ? (
        <p className="text-sm text-muted-foreground">No scores yet. Be the first on the board.</p>
      ) : (
        <ol className="space-y-1">
          {board.top.map((e, i) => {
            const you = e.wallet === board.account;
            return (
              <li key={e.wallet} className={"flex min-h-10 items-center gap-3 rounded-lg px-2 text-sm " + (you ? "bg-muted font-semibold" : "")}>
                <span className="w-5 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                {icon?.(e)}
                <span className="min-w-0 flex-1 truncate">
                  {e.name}
                  {you ? " (you)" : <span className="ml-1 text-xs font-normal text-muted-foreground">{shortAddress(e.wallet)}</span>}
                </span>
                <span className="tabular-nums">{e.score.toLocaleString()}</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Scores are sent by players' own devices.</p>
    </section>
  );
}

const SAID: Record<Exclude<PostResult, "failed">, string> = {
  saved: "You're on the board!",
  "not-best": "Your best on the board is already higher. Beat it to move up.",
  cancelled: "Not posted. You can try again any time.",
};

/**
 * Post a finished run: a name box and one button. Playing never needs a wallet; this is the only
 * place that asks for one, and it says so before the person taps.
 */
export function PostScore({ board, score, extra, className = "" }: { board: LeaderboardState; score: number; extra?: string; className?: string }) {
  const [name, setName] = useState(savedName);
  const [result, setResult] = useState<PostResult | null>(null);
  if (score <= 0) return null;
  if (result === "saved") return <p className={"text-sm font-medium " + className}>{SAID.saved}</p>;
  return (
    <form
      className={"space-y-2 " + className}
      onSubmit={async (e) => {
        e.preventDefault();
        setResult(await board.post(name, score, extra));
      }}
    >
      <label htmlFor="board-name" className="text-sm font-medium">
        Your name on the board
      </label>
      <div className="flex gap-2">
        <Input id="board-name" value={name} maxLength={20} autoComplete="nickname" placeholder="Your name" onChange={(e) => setName(e.target.value)} className="min-h-11" />
        <Button type="submit" disabled={board.posting || !name.trim()} className="min-h-11 shrink-0">
          {board.posting ? "Waiting for your wallet…" : "Post score"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {board.inMiniPay ? "Posting costs a small network fee, paid in dollars." : "Posting asks your wallet for one free signature, no fee. Playing never needs a wallet."}
      </p>
      {result && result !== "failed" && <p className="text-sm">{SAID[result]}</p>}
      {result === "failed" && board.error && (
        <p className="text-sm text-danger" role="alert">
          {board.error}
        </p>
      )}
    </form>
  );
}
`;
