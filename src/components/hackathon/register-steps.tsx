"use client";

import * as React from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";

import { useSendGate } from "@/components/auth/send-gate";
import { useGoodIdVerify } from "@/components/auth/use-goodid-verify";
import { useAuth } from "@/lib/auth/context";
import { shortAddress } from "@/lib/format";
import { LINK_WALLET_GUIDE } from "@/lib/goodid";
import { cn } from "@/lib/utils";

import { styles } from "./styles";
import { DEPLOY_CREDITS, START_CREDITS, useHackathonClaim } from "./use-hackathon-claim";

/**
 * Register in three moves: sign in with a wallet (the existing modal, which also takes the 18+ and
 * not-a-US-person attestation), verify with GoodDollar (the chain decides, D30), then claim
 * hackathon credits (D99: one grant per GoodDollar root, in two parts).
 */
export function RegisterSteps() {
  const auth = useAuth();
  const { openConnect } = useSendGate();
  const user = auth.user;
  const [verifiedHere, setVerifiedHere] = React.useState(false);
  const verified = Boolean(user?.verified) || verifiedHere;
  const confettiRef = React.useRef<HTMLCanvasElement>(null);
  const returning = React.useRef(typeof window !== "undefined" && new URL(window.location.href).searchParams.has("isVerified"));

  const celebrate = React.useCallback(() => burst(confettiRef.current), []);
  const claim = useHackathonClaim(user && verified ? user.id : null, celebrate);

  const { busy, note, showLinkGuide, verify } = useGoodIdVerify(
    () => {
      setVerifiedHere(true);
      void claim.run();
    },
    () => `${window.location.origin}${window.location.pathname}`,
  );

  // Back from GoodDollar: bring the steps into view.
  React.useEffect(() => {
    if (returning.current) document.getElementById("register")?.scrollIntoView({ block: "start" });
  }, []);

  const connecting = auth.phase === "connecting" || auth.phase === "signing";

  return (
    <>
      <canvas ref={confettiRef} className={styles.confetti} aria-hidden />
      <div className={styles.reg}>
        <div className={cn(styles.card, styles.step, user ? styles.done : styles.active)}>
          <div className={styles.n}>1</div>
          <h3>Connect wallet</h3>
          <p>MetaMask, Valora, MiniPay, OKX or any WalletConnect wallet on Celo. We never hold your keys.</p>
          <div className={styles.act}>
            {user ? (
              <span className={cn(styles.status, styles.ok)}>
                <span className={styles.check}>
                  <Check size={12} strokeWidth={3} aria-hidden />
                </span>
                Signed in as {shortAddress(user.wallet)}
              </span>
            ) : (
              <>
                <button type="button" className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-white transition-transform duration-200 ease-gb hover:-translate-y-px disabled:opacity-60" onClick={openConnect} disabled={connecting || !auth.ready}>
                  {connecting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <span className="size-1.5 rounded-full bg-pink" aria-hidden />}
                  {connecting ? "Check your wallet" : "Connect wallet"}
                </button>
                <span className={styles.status}>{auth.configured ? "Not connected" : "Sign-in is off on this server"}</span>
              </>
            )}
          </div>
        </div>

        <div className={cn(styles.card, styles.step, !user ? styles.locked : verified ? styles.done : styles.active)}>
          <div className={styles.n}>2</div>
          <h3>Verify on GoodDollar</h3>
          <p>A one-time face check with GoodDollar. It proves you are a unique person without sharing your identity with us.</p>
          <div className={styles.act} aria-live="polite">
            {verified ? (
              <span className={cn(styles.status, styles.ok)}>
                <span className={styles.check}>
                  <Check size={12} strokeWidth={3} aria-hidden />
                </span>
                Unique human confirmed
              </span>
            ) : (
              <>
                <button type="button" className={styles.btnV} disabled={!user || busy} onClick={() => void verify()}>
                  {busy ? "Checking with GoodDollar" : "Verify with GoodDollar"}
                  <span className={styles.disc}>{busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArrowRight className="size-3.5" aria-hidden />}</span>
                </button>
                <span className={styles.status}>{!user ? "Waiting for wallet" : "Takes about a minute"}</span>
                {user && (
                  <a className={styles.linkGhost} href={LINK_WALLET_GUIDE} target="_blank" rel="noreferrer">
                    Already verified on another wallet?
                  </a>
                )}
                {note && (
                  <p className={styles.error} role="alert">
                    {note}
                    {showLinkGuide && " If you verified on another wallet, link this one to it, then press Verify."}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className={cn(styles.card, styles.step, styles.final, verified ? cn(styles.done, styles.active) : styles.locked)}>
          <div className={styles.n}>3</div>
          <h3>Get build credits</h3>
          <p>
            {START_CREDITS} credits when you register, and {DEPLOY_CREDITS} more after your first deploy on Celo. Top up any time like everyone else.
          </p>
          <div className={styles.act} aria-live="polite">
            {!verified ? (
              <span className={styles.status} style={{ color: "rgba(255,255,255,.7)" }}>
                Unlocks after step 2
              </span>
            ) : claim.status?.registered ? (
              <>
                <div className={styles.finalBig}>
                  {claim.status.startCredits + claim.status.deployCredits} <span>credits</span>
                </div>
                <span className={styles.status} style={{ color: "rgba(255,255,255,.8)" }}>
                  {claim.status.deployPending ? `Deploy your entry on Celo to unlock ${DEPLOY_CREDITS} more.` : "All hackathon credits collected."}
                </span>
                {claim.status.deployPending && (
                  <button type="button" className={styles.ghostLight} disabled={claim.busy} onClick={() => void claim.run()}>
                    {claim.busy ? "Checking…" : "I've deployed, check again"}
                  </button>
                )}
              </>
            ) : (
              <button type="button" className={styles.cta} disabled={claim.busy || claim.status === null} onClick={() => void claim.run()}>
                {claim.busy ? "Registering…" : `Claim ${START_CREDITS} credits`}
                <span className={styles.disc}>{claim.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}</span>
              </button>
            )}
            {claim.error && (
              <p className={styles.error} role="alert" style={{ color: "#FFD1EF" }}>
                {claim.error}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** One pink burst from the credits card, under 1.2s (DESIGN_SYSTEM §4). Off under reduced motion. */
function burst(canvas: HTMLCanvasElement | null) {
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ctx = canvas.getContext("2d");
  const origin = canvas.nextElementSibling?.lastElementChild?.getBoundingClientRect();
  if (!ctx || !origin) return;
  const d = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * d;
  canvas.height = innerHeight * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;
  const colors = ["#FF85D9", "#592E81", "#E2D2F0", "#FFFFFF"];
  const parts = Array.from({ length: 120 }, (_, i) => {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 9;
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, s: 5 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[i % 4] };
  });
  const t0 = performance.now();
  const frame = (t: number) => {
    const k = (t - t0) / 1100;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (k >= 1) return;
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.98;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.roundRect(-p.s / 2, -p.s / 2, p.s, p.s, p.s * 0.28);
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
