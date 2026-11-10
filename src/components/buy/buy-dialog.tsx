"use client";

import * as React from "react";

import { Check, ChevronDown, Landmark, ShieldCheck, Wallet } from "lucide-react";

import { ActionButton, Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/context";
import { STEPS, formatAmount, nairaValid, statusIndex, type Asset, type TopUpStatus } from "./buy-logic";

const HOW = [
  { icon: ShieldCheck, title: "Verify", text: () => "Your name, date of birth and BVN or NIN, on GoodCash" },
  { icon: Landmark, title: "Transfer", text: () => "Send naira to the account number it shows you" },
  { icon: Wallet, title: "Receive", text: (asset: string) => `Approve once and ${asset} lands in your wallet` },
];
const PRESETS = [2000, 5000, 10000, 25000];
const WIDGET_SRC = "https://pay.goodcash.xyz/widget.js";

interface Quote {
  youGet: { amount: number; minimum: number };
  fees: Array<{ label: string; usd: number }>;
  validForSeconds: number;
}
interface WidgetEvent {
  type: string;
  message?: string;
  topUp?: { id?: string; status?: TopUpStatus };
}
declare global {
  interface Window {
    GoodCash?: { open: (options: Record<string, unknown>) => unknown };
  }
}

/** Moves an order forward, never back: a late or repeated event cannot undo a newer status. */
function moveForward(order: { id: string | null; status: TopUpStatus } | null, status: TopUpStatus) {
  return order && statusIndex(status) > statusIndex(order.status) ? { ...order, status } : order;
}

function loadWidget(): Promise<void> {
  if (window.GoodCash) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SRC}"]`);
    const script = existing ?? Object.assign(document.createElement("script"), { src: WIDGET_SRC, async: true });
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("We couldn't load our payment partner. Check your connection and try again.")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

/**
 * Buy G$ or CELO with naira (D81), through our payment partner GoodCash. Our dialog takes the amount, shows the price
 * with every fee, says what the person needs, and follows the order to the end. The ID details and the bank-transfer
 * details are typed and shown on GoodCash's own page (we never see them), which opens over this dialog.
 */
export function BuyDialog({ open, onOpenChange, defaultAsset = "g", onDelivered }: { open: boolean; onOpenChange: (open: boolean) => void; defaultAsset?: Asset; onDelivered?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 sm:w-[520px]">
        <BuyPanel defaultAsset={defaultAsset} onClose={() => onOpenChange(false)} onDelivered={onDelivered} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounts only while the dialog is open, so every opening starts fresh. */
function BuyPanel({ defaultAsset, onClose, onDelivered }: { defaultAsset: Asset; onClose: () => void; onDelivered?: () => void }) {
  const auth = useAuth();
  const wallet = auth.wallet?.address ?? auth.user?.wallet ?? null;
  const [asset, setAsset] = React.useState<Asset>(defaultAsset);
  const [naira, setNaira] = React.useState("5000");
  const [config, setConfig] = React.useState<{ enabled: boolean; publishableKey: string | null; test: boolean } | null | undefined>(undefined);
  // A quote belongs to the amount and asset it was asked for; for any other it is still loading.
  const [quoteState, setQuoteState] = React.useState<{ key: string; quote: Quote | null; error: string | null } | null>(null);
  const [order, setOrder] = React.useState<{ id: string | null; status: TopUpStatus } | null>(null);
  const [starting, setStarting] = React.useState(false);
  // "pay" while GoodCash's panel is open inside this dialog.
  const [stage, setStage] = React.useState<"form" | "pay">("form");
  const [panelReady, setPanelReady] = React.useState(false);
  const container = React.useRef<HTMLDivElement>(null);
  const handle = React.useRef<{ close: () => void } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const delivered = React.useRef(onDelivered);
  React.useEffect(() => {
    delivered.current = onDelivered;
  });

  const amount = Number(naira);
  const quoteKey = `${amount}:${asset}`;
  const valid = nairaValid(amount);
  const label = asset === "g" ? "G$" : "CELO";

  React.useEffect(() => {
    let live = true;
    fetch("/api/buy/config", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setConfig(d))
      .catch(() => live && setConfig(null));
    return () => {
      live = false;
    };
  }, []);

  // A live price, asked a moment after the person stops typing, and again before the old one runs out (about 30 seconds).
  React.useEffect(() => {
    if (!config?.enabled || !valid || stage === "pay") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const key = `${amount}:${asset}`;
    const load = () => {
      fetch(`/api/buy/quote?amountNaira=${amount}&asset=${asset}`, { cache: "no-store", credentials: "same-origin" })
        .then(async (r) => ({ ok: r.ok, body: (await r.json().catch(() => null)) as (Quote & { message?: string }) | null }))
        .then(({ ok, body }) => {
          if (!live) return;
          if (ok && body) {
            setQuoteState({ key, quote: body, error: null });
            timer = setTimeout(load, Math.max(10, (body.validForSeconds ?? 30) - 5) * 1000);
          } else {
            setQuoteState({ key, quote: null, error: body?.message ?? "We can't price that right now." });
          }
        })
        .catch(() => live && setQuoteState({ key, quote: null, error: "We can't price that right now." }));
    };
    const first = setTimeout(load, 350);
    return () => {
      live = false;
      clearTimeout(first);
      clearTimeout(timer);
    };
  }, [config?.enabled, valid, amount, asset, stage]);

  // Follow the order after the widget made it. The widget's events move the steps at once; this keeps them true if an event is missed.
  const forward = (status: TopUpStatus) => setOrder((o) => moveForward(o, status));
  const orderId = order?.id ?? null;
  const finished = order?.status === "delivered" || order?.status === "failed" || order?.status === "expired";
  React.useEffect(() => {
    if (!orderId || finished) return;
    let live = true;
    const timer = setInterval(() => {
      fetch(`/api/buy/topups/${orderId}`, { cache: "no-store", credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { status?: TopUpStatus } | null) => d?.status && live && forward(d.status))
        .catch(() => undefined);
    }, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [orderId, finished]);

  const isDelivered = order?.status === "delivered";
  React.useEffect(() => {
    if (isDelivered) delivered.current?.();
  }, [isDelivered]);

  async function start() {
    if (!config?.publishableKey || !valid || !wallet || !container.current) return;
    setStarting(true);
    setError(null);
    try {
      await loadWidget();
      setOrder(null);
      setPanelReady(false);
      setStage("pay");
      container.current.replaceChildren();
      // Embed mode with our own container: the panel is an iframe inside this dialog, so the dialog's focus and click handling
      // never fights an overlay on the page. The wallet is pinned to the signed-in one.
      handle.current = window.GoodCash?.open({
        publishableKey: config.publishableKey,
        flow: "topup",
        mode: "embed",
        container: container.current,
        amountNaira: amount,
        asset,
        wallet,
        partnerRef: auth.user?.id,
        onEvent: (e: WidgetEvent) => {
          if (e.type === "closed") {
            // Closed before an order existed: back to the form. With an order, keep following it.
            setOrder((o) => {
              if (!o) setStage("form");
              return o;
            });
            return;
          }
          if (e.type === "error") {
            setError(e.message ?? "Something went wrong. Nothing was charged.");
            setStage("form");
            return;
          }
          if (!e.type.startsWith("topup.")) return;
          const id = e.topUp?.id ?? null;
          const status = e.topUp?.status ?? (e.type === "topup.paid_in" ? "paid_in" : e.type === "topup.delivered" ? "delivered" : e.type === "topup.failed" ? "failed" : "awaiting_payment");
          setOrder((o) => (o ? { ...(moveForward(o, status) ?? o), id: id ?? o.id } : { id, status }));
        },
      }) as { close: () => void } | null;
      container.current.querySelector("iframe")?.addEventListener("load", () => setPanelReady(true), { once: true });
    } catch (e) {
      setStage("form");
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  function back() {
    handle.current?.close();
    handle.current = null;
    setOrder(null);
    setStage("form");
  }

  const current = quoteState?.key === quoteKey ? quoteState : null;
  const quote = current?.quote ?? null;
  const quoteError = current?.error ?? null;
  const total = quote?.fees.reduce((sum, f) => sum + f.usd, 0) ?? 0;
  const idx = order ? statusIndex(order.status) : -1;

  const failed = order?.status === "failed" || order?.status === "expired";
  const done = order?.status === "delivered";
  const showForm = config?.enabled && stage === "form";
  const showPay = config?.enabled && stage === "pay";

  return (
    <>
      <div className="flex items-center justify-between gap-3 pr-10">
        <span className="eyebrow">Add funds</span>
        {config?.test && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-1 text-[11px] font-semibold text-violet">
            <span className="size-1.5 rounded-full bg-violet" aria-hidden />
            Test mode · no real money
          </span>
        )}
      </div>
      <DialogTitle className="display mt-2 text-[28px] leading-[0.95] font-bold tracking-[-0.03em] uppercase">Buy {label}</DialogTitle>
      <DialogDescription className="mt-2 text-sm text-grey-600">Pay naira from a Nigerian bank account. {label} lands in your own wallet in a few minutes.</DialogDescription>

      {config === undefined && <div className="mt-6 h-64 rounded-card bg-tint motion-safe:animate-pulse" aria-label="Loading" />}
      {config === null && <p className="mt-6 text-sm text-grey-600">Sign in with a wallet to buy.</p>}
      {config && !config.enabled && <p className="mt-6 rounded-block bg-tint px-4 py-3 text-sm text-grey-600">Buying isn&apos;t switched on yet. Check back soon.</p>}

      {showForm && (
        <div className="mt-5 space-y-3">
          <div role="radiogroup" aria-label="What to buy" className="grid grid-cols-2 gap-1 rounded-full bg-tint p-1">
            {(["g", "celo"] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={asset === a}
                onClick={() => setAsset(a)}
                className={`flex items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-semibold transition-[background-color,box-shadow,color] duration-200 ease-gb outline-none focus-visible:shadow-focus ${asset === a ? "bg-surface text-ink shadow-card" : "text-grey-600 hover:text-ink"}`}
              >
                <span className={`grid size-5 place-items-center rounded-full text-[9px] font-bold ${a === "g" ? "bg-violet text-white" : "bg-[#FCFF52] text-ink"}`} aria-hidden>
                  {a === "g" ? "G$" : "C"}
                </span>
                {a === "g" ? "G$" : "CELO"}
              </button>
            ))}
          </div>

          <div className="rounded-card bg-surface p-5 shadow-card">
            <label htmlFor="buy-naira" className="eyebrow block text-grey-600">
              You pay
            </label>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="display text-[34px] leading-none font-bold text-grey-400" aria-hidden>
                ₦
              </span>
              <input
                id="buy-naira"
                type="number"
                inputMode="numeric"
                min={1000}
                max={2000000}
                step={500}
                value={naira}
                onChange={(e) => setNaira(e.target.value)}
                className="display min-w-0 flex-1 bg-transparent text-[40px]! leading-none font-bold tracking-[-0.03em] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div role="radiogroup" aria-label="Quick amounts" className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={amount === p}
                  onClick={() => setNaira(String(p))}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ease-gb outline-none focus-visible:shadow-focus ${amount === p ? "bg-violet text-white" : "bg-tint text-violet hover:bg-violet-soft"}`}
                >
                  ₦{p.toLocaleString("en-US")}
                </button>
              ))}
            </div>

            <div className="my-4 h-px bg-hairline" />

            <div aria-live="polite">
              <span className="eyebrow block text-grey-600">You get about</span>
              {!valid && <p className="mt-1 text-sm text-warning">Pick an amount from ₦1,000 to ₦2,000,000.</p>}
              {valid && !current && <div className="mt-2 h-10 w-48 rounded-block bg-tint motion-safe:animate-pulse" />}
              {valid && quoteError && <p className="mt-1 text-sm text-warning">{quoteError}</p>}
              {valid && quote && (
                <>
                  <p className="display mt-1 text-[34px] leading-none font-bold tracking-[-0.03em] text-violet">
                    {formatAmount(quote.youGet.amount, asset)} <span className="text-xl">{label}</span>
                  </p>
                  <details className="group mt-3 text-xs text-grey-600">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-full bg-tint px-3.5 py-2 outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                      <span>
                        At least {formatAmount(quote.youGet.minimum, asset)} {label} · fees ${total.toFixed(2)}
                      </span>
                      <ChevronDown className="size-3.5 transition-transform duration-200 group-open:rotate-180" aria-hidden />
                    </summary>
                    <ul className="mt-2 space-y-1.5 px-1">
                      {quote.fees.map((f) => (
                        <li key={f.label} className="flex justify-between gap-3">
                          <span>{f.label}</span>
                          <span className="text-ink">${f.usd.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
            </div>
          </div>

          <ol className="grid grid-cols-3 gap-2" aria-label="How it works">
            {HOW.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="rounded-block bg-tint p-3">
                <span className="grid size-7 place-items-center rounded-full bg-surface text-violet">
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <p className="mt-2 text-xs font-semibold text-ink">
                  {i + 1}. {title}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-grey-600">{text(label)}</p>
              </li>
            ))}
          </ol>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-block bg-tint px-3 py-2.5 text-sm text-danger">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
              {error}
            </p>
          )}
          <ActionButton className="w-full justify-between" disabled={!valid || !quote || !wallet || starting} onClick={() => void start()}>
            {starting ? "Opening…" : `Continue with ₦${valid ? amount.toLocaleString("en-US") : ""}`}
          </ActionButton>
          <p className="text-center text-[11px] text-grey-600">Needs a Nigerian bank account, your BVN or NIN, and to be 18 or older. GoodCash, our payment partner, handles your ID and bank details; we never see them.</p>
        </div>
      )}

      {/* GoodCash's panel (an iframe) is put here by the widget. The container stays mounted so the widget can find it. The
          skeleton behind it shows while the panel loads, and is hidden by the panel's own background once it has. */}
      <div className={showPay && !(order && finished) ? "relative mt-5 min-h-[min(640px,calc(100dvh-16rem))] overflow-hidden rounded-card" : "hidden"}>
        {!panelReady && (
          <div className="absolute inset-0 grid place-items-center bg-tint text-sm text-grey-600 motion-safe:animate-pulse" aria-hidden>
            Opening GoodCash…
          </div>
        )}
        <div ref={container} className={`relative flex justify-center transition-opacity duration-300 [&_iframe]:h-[min(640px,calc(100dvh-16rem))]! ${panelReady ? "opacity-100" : "opacity-0"}`} />
      </div>

      {showPay && (
        <div className="mt-5 space-y-4" aria-live="polite">
          {!order && <p className="text-center text-xs text-grey-600">Follow the steps above. This screen updates when your order starts.</p>}

          {order && !done && !failed && (
            <ol className="rounded-card bg-surface p-5 shadow-card">
              {STEPS.map((st, i) => {
                const complete = i <= idx;
                const active = i === idx + 1;
                return (
                  <li key={st.key} className="relative flex items-start gap-3 pb-5 last:pb-0">
                    {i < STEPS.length - 1 && <span className={`absolute top-7 left-[13px] h-[calc(100%-20px)] w-0.5 rounded-full ${complete ? "bg-violet" : "bg-tint"}`} aria-hidden />}
                    <span className={`relative grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${complete ? "bg-violet text-white" : active ? "bg-tint text-violet ring-2 ring-violet" : "bg-tint text-grey-400"}`}>
                      {complete ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : active ? <span className="size-2 rounded-full bg-violet motion-safe:animate-pulse" /> : i + 1}
                    </span>
                    <span className={`pt-1 text-sm ${active ? "font-semibold text-ink" : complete ? "text-ink" : "text-grey-600"}`}>{st.label(label)}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {done && (
            <div role="status" className="rounded-card bg-surface p-6 text-center shadow-card">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-violet text-white">
                <Check className="size-7" strokeWidth={3} aria-hidden />
              </span>
              <p className="display mt-4 text-[22px] leading-[1] font-bold tracking-[-0.03em] uppercase">{label} is in your wallet</p>
              <p className="mt-2 text-sm text-grey-600">All three steps are done. You can use it right away.</p>
            </div>
          )}

          {failed && order && (
            <div role="alert" className="rounded-card bg-surface p-6 shadow-card">
              <span className="flex items-center gap-2 text-xs font-semibold text-danger">
                <span className="size-2 rounded-full bg-danger" aria-hidden />
                {order.status === "expired" ? "Order expired" : "Order didn't go through"}
              </span>
              <p className="mt-2 text-sm text-grey-600">If you already sent money, our payment partner refunds it to your bank. Nothing is lost.</p>
            </div>
          )}

          <div className="flex gap-2">
            {(!order || failed) && (
              <Button variant="secondary" className="flex-1" onClick={back}>
                {order ? "Try again" : "Back"}
              </Button>
            )}
            {order && (
              <Button variant={done ? "primary" : "secondary"} className="flex-1" onClick={onClose}>
                {done ? "Close" : "Hide"}
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
