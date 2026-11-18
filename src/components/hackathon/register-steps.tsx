"use client";
import * as React from "react";
import Link from "next/link";
import { useSendGate } from "@/components/auth/send-gate";
import { useGoodIdVerify } from "@/components/auth/use-goodid-verify";
import { useAuth } from "@/lib/auth/context";
import { shortAddress } from "@/lib/format";
import { LINK_WALLET_GUIDE } from "@/lib/goodid";
import { cn } from "@/lib/utils";
import { styles } from "./styles";
import {
  DEPLOY_CREDITS,
  START_CREDITS,
  useHackathonClaim,
} from "./use-hackathon-claim";
import { FlowstateVote } from "./flowstate-vote";
type Participant = {
  email: string;
  flowstate: "pending" | "visited" | "skipped" | "voted";
};
export function RegisterSteps() {
  const { user, ready } = useAuth();
  if (!ready) return <p role="status">Loading your signup…</p>;
  return <Registration key={user?.id ?? "guest"} />;
}
function Registration() {
  const auth = useAuth();
  const { openConnect } = useSendGate();
  const user = auth.user;
  const [participant, setParticipant] = React.useState<Participant | null>(
    null,
  );
  const [email, setEmail] = React.useState(user?.email ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [verifiedHere, setVerifiedHere] = React.useState(false);
  const verified = Boolean(user?.verified) || verifiedHere;
  const confettiRef = React.useRef<HTMLCanvasElement>(null);
  const celebrate = React.useCallback(() => burst(confettiRef.current), []);
  const claim = useHackathonClaim(user && verified ? user.id : null, celebrate);
  const { busy, note, showLinkGuide, verify } = useGoodIdVerify(
    () => setVerifiedHere(true),
    () => `${window.location.origin}/hackathon#register`,
  );
  React.useEffect(() => {
    if (!user) return;
    let stopped = false;
    void (async () => {
      try {
        const res = await fetch("/api/hackathon/participants", {
          cache: "no-store",
        });
        if (!res.ok)
          throw new Error(
            "Could not load your signup. Please refresh to try again.",
          );
        let data = await res.json();
        if (!data && user.email) {
          const saved = await fetch("/api/hackathon/participants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: user.email }),
          });
          if (!saved.ok)
            throw new Error(
              "Could not save your signup. Please try saving your email below.",
            );
          data = await saved.json();
        }
        if (!stopped && data) {
          setParticipant(data);
          setEmail(data.email);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [user]);
  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/hackathon/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.message ?? "Could not save. Try again.");
      setParticipant(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const flowDone = participant?.flowstate === "voted";
  const step = !participant ? 1 : !verified ? 2 : !flowDone ? 3 : 4;
  return (
    <>
      <canvas ref={confettiRef} className={styles.confetti} aria-hidden />
      <p className="mb-5 text-sm text-violet" role="status">
        {claim.status?.registered
          ? "You’re ready to build."
          : `Step ${step} of 4 · We’ll guide you through it.`}
      </p>
      <div className={cn(styles.reg, "hk-registration")}>
        <div
          className={cn(
            styles.card,
            styles.step,
            participant ? styles.done : styles.active,
          )}
          aria-current={step === 1 ? "step" : undefined}
        >
          <div className={styles.n}>1</div>
          <h3>Start with your email</h3>
          <p>
            Click below, enter your email, then enter the 6-digit code from your
            inbox. Your wallet is created for you. No wallet experience needed.
          </p>
          <div className={styles.act}>
            {!user ? (
              <button
                type="button"
                className={styles.btnV}
                disabled={!auth.ready}
                onClick={openConnect}
              >
                Connect with email
              </button>
            ) : (
              <>
                <p className={styles.status}>
                  Wallet connected: {shortAddress(user.wallet)}
                </p>
                {participant ? (
                  <p className={cn(styles.status, styles.ok)}>
                    ✓ Email saved: {participant.email}
                  </p>
                ) : (
                  <form
                    action="/api/hackathon/participants"
                    method="post"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save();
                    }}
                  >
                    <label htmlFor="hackathon-email">
                      Your email (required)
                    </label>
                    <input
                      className="hk-input"
                      id="hackathon-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <p className="my-2 text-xs">
                      We’ll use this for hackathon updates. It won’t appear on
                      your public project.
                    </p>
                    <button className={styles.btnV} disabled={saving}>
                      {saving ? "Saving…" : "Save email & continue"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
        <div
          className={cn(
            styles.card,
            styles.step,
            verified
              ? styles.done
              : participant
                ? styles.active
                : styles.locked,
          )}
          aria-current={step === 2 ? "step" : undefined}
        >
          <div className={styles.n}>2</div>
          <h3>Verify with GoodDollar</h3>
          <p>
            Click Verify, follow GoodDollar’s face-check instructions, then
            return here. This confirms you’re one real person and unlocks free
            credits.
          </p>
          <div className={styles.act} aria-live="polite">
            {verified ? (
              <p className={cn(styles.status, styles.ok)}>✓ You’re verified</p>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.btnV}
                  disabled={!participant || busy}
                  onClick={() => void verify()}
                >
                  {busy
                    ? "Checking your verification…"
                    : "Verify with GoodDollar"}
                </button>
                <p className={styles.status}>
                  {participant
                    ? "Have a minute and your camera ready."
                    : "Save your email in step 1 first."}
                </p>
                {participant && (
                  <a
                    className={styles.linkGhost}
                    href={LINK_WALLET_GUIDE}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Already verified with another wallet?
                  </a>
                )}
              </>
            )}
            {note && (
              <p className={styles.error} role="alert">
                {note}
                {showLinkGuide &&
                  " Link this wallet using the guide above, then try Verify again."}
              </p>
            )}
          </div>
        </div>
        <div
          className={cn(
            styles.card,
            styles.step,
            flowDone
              ? styles.done
              : verified && participant
                ? styles.active
                : styles.locked,
          )}
          aria-current={step === 3 ? "step" : undefined}
        >
          <div className={styles.n}>3</div>
          <h3>Support us on FlowState</h3>
          <p>One vote from your wallet. We cover the network fee.</p>
          <div className={styles.act}>
            {verified && participant ? (
              <>
                <FlowstateVote
                  onConfirmed={() =>
                    setParticipant({ ...participant, flowstate: "voted" })
                  }
                />
                {flowDone && (
                  <p className={styles.status}>✓ Voted. Claim your credits below.</p>
                )}
              </>
            ) : (
              <p className={styles.status}>Complete steps 1 and 2 first.</p>
            )}
          </div>
        </div>
        <div
          className={cn(
            styles.card,
            styles.step,
            styles.final,
            step === 4 ? styles.active : styles.locked,
          )}
          aria-current={step === 4 ? "step" : undefined}
        >
          <div className={styles.n}>4</div>
          <h3>Claim credits. Start building.</h3>
          <p>
            Get {START_CREDITS} free build credits now, plus {DEPLOY_CREDITS}{" "}
            after your first Celo deploy. Credits are added to your GoodBuild
            account.
          </p>
          <div className={styles.act} aria-live="polite">
            {claim.status?.registered ? (
              <>
                <div className={styles.finalBig}>
                  {claim.status.startCredits + claim.status.deployCredits}{" "}
                  <span>credits granted</span>
                </div>
                <Link className={styles.cta} href="/">
                  Start building →
                </Link>
                <Link className={styles.ghostLight} href="/home/hackathon#project">
                  Submit or update your project
                </Link>
                {claim.status.deployPending && (
                  <button
                    type="button"
                    className={styles.ghostLight}
                    disabled={claim.busy}
                    onClick={() => void claim.run()}
                  >
                    {claim.busy
                      ? "Checking…"
                      : `I’ve deployed · claim ${DEPLOY_CREDITS} more`}
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className={styles.cta}
                disabled={
                  !flowDone || !verified || claim.busy || claim.status === null
                }
                onClick={() => void claim.run()}
              >
                {claim.busy
                  ? "Adding credits…"
                  : `Claim ${START_CREDITS} free credits`}
              </button>
            )}
            {claim.error && <p role="alert">{claim.error}</p>}
          </div>
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** One pink burst from the credits card, under 1.2s (DESIGN_SYSTEM §4). Off under reduced motion. */
function burst(canvas: HTMLCanvasElement | null) {
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  const ctx = canvas.getContext("2d");
  const origin =
    canvas.nextElementSibling?.lastElementChild?.getBoundingClientRect();
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
    return {
      x: ox,
      y: oy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 4,
      s: 5 + Math.random() * 7,
      r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[i % 4],
    };
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
