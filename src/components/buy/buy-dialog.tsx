"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/context";
import { NEEDS, STEPS, formatAmount, nairaValid, statusIndex, type Asset, type TopUpStatus } from "./buy-logic";

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
 * Buy G$ or CELO with naira (D63), through our payment partner GoodCash. Our dialog takes the amount, shows the price
 * with every fee, says what the person needs, and follows the order to the end. The ID details and the bank-transfer
 * details are typed and shown on GoodCash's own page (we never see them), which opens over this dialog.
 */
export function BuyDialog({ open, onOpenChange, defaultAsset = "g", onDelivered }: { open: boolean; onOpenChange: (open: boolean) => void; defaultAsset?: Asset; onDelivered?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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

  return (
    <>
        <DialogTitle className="display text-xl font-bold">Buy {label}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-grey-600">
          Pay naira from your Nigerian bank account and get {label} in your own wallet. Our payment partner GoodCash handles the payment; we never see your bank or ID details.
        </DialogDescription>

        {config === undefined && <p className="mt-5 text-sm text-grey-600">Checking…</p>}
        {config === null && <p className="mt-5 text-sm text-grey-600">Sign in with a wallet to buy.</p>}
        {config && !config.enabled && <p className="mt-5 text-sm text-grey-600">Buying isn&apos;t switched on yet. Check back soon.</p>}

        {config?.enabled && stage === "form" && (
          <div className="mt-5 space-y-4">
            <div role="radiogroup" aria-label="What to buy" className="grid grid-cols-2 gap-2">
              {(["g", "celo"] as const).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={asset === a} onClick={() => setAsset(a)} className={`rounded-2xl px-3 py-2.5 text-sm font-semibold ${asset === a ? "bg-violet text-white" : "bg-tint text-ink"}`}>
                  {a === "g" ? "G$ (GoodDollar)" : "CELO (network fees)"}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Amount in naira" className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={amount === p} onClick={() => setNaira(String(p))} className={`rounded-2xl px-1 py-2.5 text-center text-sm font-semibold ${amount === p ? "bg-violet text-white" : "bg-tint text-ink"}`}>
                  ₦{p.toLocaleString("en-US")}
                </button>
              ))}
            </div>
            <label className="block text-sm">
              <span className="text-grey-600">Or enter an amount (₦1,000 to ₦2,000,000)</span>
              <input type="number" inputMode="numeric" min={1000} max={2000000} step={500} value={naira} onChange={(e) => setNaira(e.target.value)} className="mt-1 w-full rounded-full bg-tint px-4 py-2.5 text-base outline-none focus-visible:shadow-focus" />
            </label>

            <div className="rounded-2xl bg-tint px-4 py-3 text-sm" aria-live="polite">
              {!valid && <span className="text-warning">Pick an amount from ₦1,000 to ₦2,000,000.</span>}
              {valid && !current && <span className="text-grey-600">Getting your price…</span>}
              {valid && quoteError && <span className="text-warning">{quoteError}</span>}
              {valid && quote && (
                <>
                  <p>
                    You get about <b>{formatAmount(quote.youGet.amount, asset)} {label}</b>
                    <span className="text-grey-600"> (at least {formatAmount(quote.youGet.minimum, asset)})</span>
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs text-grey-600">
                    {quote.fees.map((f) => (
                      <li key={f.label} className="flex justify-between gap-3">
                        <span>{f.label}</span>
                        <span>${f.usd.toFixed(2)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t border-grey-200 pt-1 font-semibold text-ink">
                      <span>Fees in total</span>
                      <span>${total.toFixed(2)}</span>
                    </li>
                  </ul>
                </>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold">What you&apos;ll need</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-grey-600">
                {NEEDS.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>

            {config.test && <p className="rounded-xl bg-tint px-3 py-2 text-xs text-grey-600">Test mode: nothing real is bought and no money moves.</p>}
            {error && (
              <p role="alert" className="text-sm text-warning">
                {error}
              </p>
            )}
            <Button variant="primary" className="w-full" disabled={!valid || !quote || !wallet || starting} onClick={() => void start()}>
              {starting ? "Opening…" : `Continue to pay ₦${valid ? amount.toLocaleString("en-US") : ""}`}
            </Button>
            <p className="text-center text-xs text-grey-600">Next, GoodCash&apos;s secure panel opens here. You enter your ID details and see the bank-transfer details there, then approve once in your wallet. Use the wallet you are signed in with.</p>
          </div>
        )}

        {/* GoodCash's panel (an iframe) is put here by the widget. The container stays mounted so the widget can find it. */}
        <div ref={container} className={stage === "pay" && !(order && finished) ? "mt-4 flex justify-center overflow-hidden" : "hidden"} />

        {config?.enabled && stage === "pay" && (
          <div className="mt-4 space-y-4" aria-live="polite">
            {!order && <p className="text-center text-xs text-grey-600">Follow the steps above. This screen updates when your order starts.</p>}
            {order && (
              <ol className="space-y-2">
                {STEPS.map((s, i) => {
                  const failed = order.status === "failed" || order.status === "expired";
                  const done = !failed && i <= idx;
                  const current = !failed && i === idx + 1;
                  return (
                    <li key={s.key} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm ${done || current ? "bg-tint text-ink" : "text-grey-600"}`}>
                      <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-violet text-white" : "bg-grey-200"}`}>{done ? "✓" : i + 1}</span>
                      <span className={current ? "font-semibold" : ""}>{s.label(label)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {order?.status === "delivered" && (
              <p role="status" className="text-sm text-success">
                Done. {label} is in your wallet.
              </p>
            )}
            {(order?.status === "failed" || order?.status === "expired") && (
              <p role="alert" className="text-sm text-warning">
                The order {order.status === "expired" ? "expired" : "didn't go through"}. If you already sent money, our payment partner refunds it to your bank.
              </p>
            )}
            <div className="flex gap-2">
              {(!order || order.status === "failed" || order.status === "expired") && (
                <Button variant="secondary" className="flex-1" onClick={back}>
                  {order ? "Try again" : "Back"}
                </Button>
              )}
              {order && (
                <Button variant={order.status === "delivered" ? "primary" : "secondary"} className="flex-1" onClick={onClose}>
                  {order.status === "delivered" ? "Close" : "Hide"}
                </Button>
              )}
            </div>
          </div>
        )}
    </>
  );
}
