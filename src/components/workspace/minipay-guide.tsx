"use client";

import * as React from "react";
import { Check, Smartphone, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useDeployAction } from "@/components/deploy/deploy-trigger";
import { miniPayChecklist } from "@/lib/minipay-checklist";
import { cn } from "@/lib/utils";
import type { PublishInfo } from "./use-publish";

/**
 * The MiniPay guide (D88, option A, picked by the owner on 11 Nov 2026): step cards in the chat for
 * a project with the MiniPay kit. Deploying (when the app has contracts) and publishing come first,
 * and the MiniPay steps stay locked until both are done, because MiniPay opens the public link and
 * the game needs its live contract. The phone drawings are simple sketches, not MiniPay's real
 * screens, so they don't go out of date when MiniPay changes its look.
 */

const CELO_MAINNET = 42220;

type Screen = "deploy" | "publish" | "link" | "settings" | "version" | "devrow" | "toggles" | "load" | "game";

interface Step {
  id: string;
  title: string;
  body: string;
  screen: Screen;
  /** Why Next is locked on this step, or null once it's done. */
  locked?: string | null;
  action?: React.ReactNode;
  extra?: React.ReactNode;
}

const DISMISS_KEY = (projectId: string) => `gb:minipay-guide:${projectId}`;

function readDismissed(projectId: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY(projectId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(projectId: string, value: boolean) {
  try {
    if (value) window.localStorage.setItem(DISMISS_KEY(projectId), "1");
    else window.localStorage.removeItem(DISMISS_KEY(projectId));
  } catch {
    // Private mode: the guide just shows again next time.
  }
}

export function MiniPayGuide({
  projectId,
  chainId,
  files,
  hasContracts,
  outdatedContracts,
  publish,
  onPublish,
  onAsk,
  busy,
}: {
  projectId: string;
  chainId: number;
  files: Record<string, string>;
  hasContracts: boolean;
  /** Contracts whose live version is older than the code. */
  outdatedContracts: string[];
  publish: PublishInfo | null;
  onPublish: () => void;
  /** Send the builder a request (for "Fix these"). */
  onAsk: (prompt: string) => void;
  busy: boolean;
}) {
  const deploy = useDeployAction();
  // Read on the first render: the guide renders nothing until publish status arrives in the browser, so the server never sees it.
  const [dismissed, setDismissed] = React.useState(() => typeof window !== "undefined" && readDismissed(projectId));
  const [copied, setCopied] = React.useState<"yes" | "no" | null>(null);

  const deployed = !hasContracts || (publish !== null && publish.undeployed.length === 0 && outdatedContracts.length === 0);
  const live = Boolean(publish?.live && !publish.disabled);
  const upToDate = live && publish?.publishedVersion === publish?.currentVersion;
  const testnet = chainId !== CELO_MAINNET;
  const link = publish?.url ?? "";
  const checklist = React.useMemo(() => miniPayChecklist(files), [files]);
  const todo = checklist.filter((i) => i.status === "todo");
  const checked = checklist.filter((i) => i.how === "checked" && i.status !== "not-needed");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
    window.setTimeout(() => setCopied(null), 1600);
  }

  const steps: Step[] = [
    ...(hasContracts
      ? [
          {
            id: "deploy",
            title: deployed ? "Contract deployed" : "Deploy your game's contract",
            body: deployed
              ? "Your game's contract is live on Celo."
              : outdatedContracts.length
                ? "Your contract has changes that aren't live yet. Deploy again from your wallet first."
                : "Sign it in your wallet. The game in MiniPay uses this contract.",
            screen: "deploy" as const,
            locked: deployed ? null : "Deploy first",
            action: deployed ? undefined : (
              <Button size="sm" disabled={Boolean(deploy.blocked) || busy} title={deploy.blocked ?? undefined} onClick={deploy.open}>
                {outdatedContracts.length ? "Deploy again" : "Deploy"}
              </Button>
            ),
          },
        ]
      : []),
    {
      id: "publish",
      title: upToDate ? "Game published" : live ? "Publish your latest version" : "Publish your game",
      body: upToDate
        ? "MiniPay opens your game from its public link."
        : live
          ? "The public link still has an older version. Publish again so MiniPay gets this one."
          : "MiniPay opens your game from a public link. Publishing gives it one.",
      screen: "publish",
      locked: !deployed ? "Deploy first" : upToDate ? null : "Publish first",
      action:
        deployed && !upToDate ? (
          <Button size="sm" disabled={busy} onClick={onPublish}>
            {live ? "Publish again" : "Publish"}
          </Button>
        ) : undefined,
    },
    {
      id: "link",
      title: "Copy your game's link",
      body: "You'll paste it into MiniPay in a moment. Keep this open, or send the link to your phone.",
      screen: "link",
      extra: link ? (
        <div className="mt-3 flex min-w-0 items-center gap-2 rounded-xl bg-tint py-1.5 pr-1.5 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-violet select-all">{link.replace(/^https:\/\//, "")}</code>
          <Button size="sm" onClick={() => void copy()}>
            {copied === "yes" ? "Copied" : copied === "no" ? "Select it" : "Copy"}
          </Button>
        </div>
      ) : undefined,
    },
    { id: "settings", title: "Open MiniPay's Settings", body: "On your phone, open MiniPay and go to Settings. Find the About section.", screen: "settings" },
    {
      id: "version",
      title: "Tap the Version number",
      body: "Keep tapping Version until a message says developer mode is on. You only do this once.",
      screen: "version",
    },
    { id: "devrow", title: "Open Developer Settings", body: "Go back to Settings. A new Developer Settings row is there.", screen: "devrow" },
    testnet
      ? {
          id: "toggles",
          title: "Turn on Developer Mode and Use Testnet",
          body: "Your game is on Celo's test network, so MiniPay needs to be on it too.",
          screen: "toggles",
        }
      : {
          id: "toggles",
          title: "Turn on Developer Mode",
          body: "Leave Use Testnet off: your game is on Celo's main network.",
          screen: "toggles",
        },
    { id: "load", title: "Load test page, paste, Load", body: "Tap Load test page, paste your link and tap Load.", screen: "load" },
    {
      id: "check",
      title: "Check it works",
      body: "It should open with no Connect button. Play a round, and tap the links at the bottom.",
      screen: "game",
      extra: (
        <div className="mt-3 space-y-1.5 text-xs">
          <p className="flex items-start gap-2">
            <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-white", todo.length ? "bg-warning" : "bg-success")} aria-hidden>
              {todo.length ? "!" : <Check className="size-3" strokeWidth={3} />}
            </span>
            <span>
              GoodBuild checked {checked.length - todo.length} of {checked.length} things MiniPay needs.
              {todo.length ? ` Still to do: ${todo.map((i) => i.label.toLowerCase()).join("; ")}.` : ""}
            </span>
          </p>
          {todo.length > 0 && (
            <Button variant="chip" size="chip" disabled={busy} onClick={() => onAsk(`Make the app meet these MiniPay requirements: ${todo.map((i) => i.label).join("; ")}.`)}>
              Fix these
            </Button>
          )}
        </div>
      ),
    },
  ];

  // Start where there's something to do: the first locked step, or the link once everything is ready.
  const firstLocked = steps.findIndex((s) => s.locked);
  const start = firstLocked === -1 ? steps.findIndex((s) => s.id === "link") : firstLocked;
  const [index, setIndex] = React.useState(start);
  // A deploy or a publish finished: move on from the step it unlocked.
  const lastStart = React.useRef(start);
  React.useEffect(() => {
    if (start > lastStart.current) setIndex((i) => (i < start ? start : i));
    lastStart.current = start;
  }, [start]);

  if (!publish?.hasApp) return null;
  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => {
          writeDismissed(projectId, false);
          setDismissed(false);
        }}
        className="inline-flex items-center gap-2 rounded-full bg-tint px-3.5 py-1.5 text-[13px] font-medium text-violet outline-none hover:bg-violet-soft focus-visible:shadow-focus"
      >
        <Smartphone className="size-4" aria-hidden /> Test it in MiniPay
      </button>
    );
  }

  const i = Math.min(index, steps.length - 1);
  const step = steps[i];
  const last = i === steps.length - 1;
  return (
    <section aria-label="Test it in MiniPay" className="rounded-block bg-canvas p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-[13px] font-bold tracking-[-0.01em] text-violet-ink uppercase">Test it in MiniPay</h3>
        <button
          type="button"
          aria-label="Hide the MiniPay guide"
          onClick={() => {
            writeDismissed(projectId, true);
            setDismissed(true);
          }}
          className="grid size-7 place-items-center rounded-full text-grey-600 outline-none hover:bg-tint hover:text-violet focus-visible:shadow-focus"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="rounded-block bg-surface p-4 shadow-card">
        <div className="flex min-w-0 flex-col items-stretch gap-4 sm:flex-row sm:items-center">
          <Phone screen={step.screen} link={link} testnet={testnet} done={!step.locked} />
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-[11px] font-semibold tracking-[.14em] text-violet uppercase">
              Step {i + 1} of {steps.length}
            </p>
            <p className="mt-1.5 text-[15px] leading-snug font-semibold">{step.title}</p>
            <p className="mt-1 text-[13px] text-grey-600">{step.body}</p>
            {step.action && <div className="mt-3">{step.action}</div>}
            {step.extra}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => setIndex(i - 1)}>
            Back
          </Button>
          <div className="flex gap-1.5" aria-hidden>
            {steps.map((s, n) => (
              <span key={s.id} className={cn("h-1.5 rounded-full transition-[width,background-color] duration-200", n === i ? "w-4 bg-violet" : "w-1.5", n !== i && (s.locked ? "bg-grey-400/40" : "bg-violet-mist"))} />
            ))}
          </div>
          <Button size="sm" disabled={Boolean(step.locked)} title={step.locked ?? undefined} onClick={() => setIndex(last ? start : i + 1)}>
            {step.locked ?? (last ? "Start over" : "Next")}
          </Button>
        </div>
      </div>
    </section>
  );
}

function Tap() {
  return (
  <span className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2" aria-hidden>
    <span className="absolute inset-0 animate-ping rounded-full bg-pink/70 motion-reduce:animate-none" />
    <span className="absolute inset-0.5 rounded-full bg-pink" />
  </span>
);
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-hairline px-2.5 pt-2 pb-1.5 text-[10px] font-bold">{children}</div>;
}

function Sec({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pt-1.5 pb-0.5 text-[7px] font-semibold tracking-[.12em] text-grey-400 uppercase">{children}</div>;
}

function Row({ children, hot, right, tap }: { children: React.ReactNode; hot?: boolean; right?: React.ReactNode; tap?: boolean }) {
  return (
  <div className={cn("relative mx-1.5 flex items-center justify-between gap-1 rounded-md border-b border-hairline px-1 py-1.5", hot && "bg-violet-soft")}>
    <span>{children}</span>
    {tap ? <Tap /> : right}
  </div>
);
}

function Toggle({ on }: { on: boolean }) {
  return (
  <span className={cn("relative h-2.5 w-[18px] shrink-0 rounded-full", on ? "bg-success" : "bg-ink/15")}>
    <span className={cn("absolute top-px size-2 rounded-full bg-white", on ? "left-[9px]" : "left-px")} />
  </span>
);
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="m-2.5 rounded-md bg-canvas p-1.5 font-mono text-[7.5px] [overflow-wrap:anywhere] text-violet">{children}</div>;
}

function Btn({ children, tap = true }: { children: React.ReactNode; tap?: boolean }) {
  return (
  <div className="relative mx-2.5 rounded-full bg-ink p-1.5 text-center font-semibold text-white">
    {children}
    {tap && <Tap />}
  </div>
);
}

/** A phone sketch with a pink dot on what to tap. */
function Phone({ screen, link, testnet, done }: { screen: Screen; link: string; testnet: boolean; done: boolean }) {
  const short = link.replace(/^https:\/\//, "") || "your-game.goodbuildit.xyz";
  let inner: React.ReactNode;
  if (screen === "deploy") {
    inner = (
      <>
        <Bar>Your wallet</Bar>
        <Sec>Deploy to Celo</Sec>
        <Field>Your game&apos;s contract</Field>
        <Btn tap={!done}>{done ? "Deployed" : "Sign & deploy"}</Btn>
      </>
    );
  } else if (screen === "publish") {
    inner = (
      <>
        <Bar>GoodBuild</Bar>
        <Sec>Publish</Sec>
        <Field>{short}</Field>
        <Btn tap={!done}>{done ? "Published" : "Publish"}</Btn>
      </>
    );
  } else if (screen === "link") {
    inner = (
      <>
        <Bar>GoodBuild</Bar>
        <Sec>Published</Sec>
        <Field>{short}</Field>
        <Btn>Copy link</Btn>
      </>
    );
  } else if (screen === "settings" || screen === "version") {
    inner = (
      <>
        <Bar>Settings</Bar>
        <Sec>Account</Sec>
        <Row>Profile</Row>
        <Row>Security</Row>
        <Sec>About</Sec>
        <Row>Help</Row>
        <Row hot right={<span className="text-grey-600">x.y.z</span>} tap={screen === "version"}>
          Version
        </Row>
        {screen === "version" && <div className="absolute right-2 bottom-3 left-2 rounded-lg bg-ink px-2 py-1.5 text-center text-[8px] text-white">Developer mode is on</div>}
      </>
    );
  } else if (screen === "devrow") {
    inner = (
      <>
        <Bar>Settings</Bar>
        <Row>Profile</Row>
        <Row>Security</Row>
        <Row>Help</Row>
        <Row hot tap>
          Developer Settings
        </Row>
      </>
    );
  } else if (screen === "toggles") {
    inner = (
      <>
        <Bar>Developer Settings</Bar>
        <Row hot right={<Toggle on />}>
          Developer Mode
        </Row>
        <Row hot={testnet} right={<Toggle on={testnet} />}>
          Use Testnet
        </Row>
        <Row right={<span className="text-grey-600">›</span>}>Load test page</Row>
      </>
    );
  } else if (screen === "load") {
    inner = (
      <>
        <Bar>Load test page</Bar>
        <Sec>Your link</Sec>
        <Field>{link || "https://your-game.goodbuildit.xyz"}</Field>
        <Btn>Load</Btn>
      </>
    );
  } else {
    inner = (
      <>
        <div className="relative grid flex-1 place-items-center bg-gradient-to-b from-violet-soft to-white">
          <span className="absolute top-2 left-2.5 font-display text-[9px] font-bold text-violet-ink">SCORE 12</span>
          <span className="size-[18px] animate-bounce rounded-full bg-violet motion-reduce:animate-none" />
        </div>
        <div className="border-t border-hairline p-1.5 text-center text-[6.5px] text-grey-600">About · How to use · Terms · Privacy · Support</div>
      </>
    );
  }
  return (
    <div className="aspect-[9/18] w-[120px] shrink-0 self-center rounded-[22px] bg-ink p-1.5 sm:w-[132px]" aria-hidden>
      <div className="relative flex h-full flex-col overflow-hidden rounded-[17px] bg-white text-[9px] text-ink">{inner}</div>
    </div>
  );
}
