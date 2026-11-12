import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Clock, CreditCard, Gamepad2, Plus, Star, Users, X, type LucideIcon } from "lucide-react";

import { WalletButton } from "@/components/auth/wallet-button";
import { LogoMark } from "@/components/brand/logo";
import { FAQ, HACKATHON, MARQUEE, PARTNERS, PRIZES, RULES, TIMELINE, TRACKS, fmtGd, type Prize, type TrackIcon } from "@/components/hackathon/content";
import { CountUp } from "@/components/hackathon/count-up";
import "@/components/hackathon/hackathon.css";
import { styles } from "@/components/hackathon/styles";
import { OnView, SpotlightCard } from "@/components/hackathon/on-view";
import { PosterTiles } from "@/components/hackathon/poster-tiles";
import { RegisterSteps } from "@/components/hackathon/register-steps";
import { SITE_URL } from "@/config/site-url";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "GoodBuild Million Hackathon · 1,000,000 G$ in prizes" },
  description: "Ship a dApp on Celo that moves GoodDollar. Connect your wallet, verify once with GoodDollar, and get free build credits. 1,000,000 G$ in prizes.",
  alternates: { canonical: `${SITE_URL}/hackathon` },
  openGraph: { title: "GoodBuild Million Hackathon", description: "Build for 1,000,000 G$ in prizes. Ship a dApp on Celo." },
};

const TRACK_ICONS: Record<TrackIcon, LucideIcon> = { card: CreditCard, clock: Clock, people: Users, pad: Gamepad2, star: Star };

const NAV = [
  { href: "#prizes", label: "Prizes" },
  { href: "#register", label: "Register" },
  { href: "#tracks", label: "Tracks" },
  { href: "#timeline", label: "Timeline" },
  { href: "#partners", label: "Partners" },
  { href: "#rules", label: "Rules" },
];

/** The hackathon landing page: the poster design the owner approved on 12 Nov 2026. */
export default function HackathonPage() {
  return (
    <div className={styles.page}>
      <header className={cn(styles.nav, styles.wrap)}>
        <div className={styles.navbar}>
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-full" aria-label="GoodBuild home">
            <LogoMark />
            <span className="text-[17px] font-semibold tracking-tight">GoodBuild</span>
            <span className={styles.brandTag}>HACKATHON</span>
          </Link>
          <nav aria-label="Hackathon" className={styles.navlinks}>
            {NAV.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className={styles.navWallet}>
            <WalletButton showNetwork={false} />
          </div>
        </div>
      </header>

      <main className={styles.wrap}>
        <Poster />

        <div className={styles.marquee} aria-hidden>
          <div className={styles.track}>
            {[...MARQUEE, ...MARQUEE].map((t, i) => (
              <span key={i} className={i % 2 ? styles.outline : undefined}>
                {t}
                <i />
              </span>
            ))}
          </div>
        </div>

        <section id="prizes" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={styles.disp}>The prize pool</h2>
            <p>One million G$, split so that a winning team, every track, and the community all get paid. Amounts below are a draft split.</p>
          </div>
          <OnView className={styles.prizes} activeClassName={styles.grow}>
            {PRIZES.map((p) => (
              <PrizeCard key={p.id} prize={p} />
            ))}
          </OnView>
          <div className={styles.strip}>
            <span>Total pool</span>
            <b>{fmtGd(HACKATHON.poolGd)} G$</b>
          </div>
        </section>

        <section id="register" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={styles.disp}>
              Register in
              <br />
              three moves
            </h2>
            <p>No forms. Your wallet is your entry, and a GoodDollar face check proves you are one real person. Verified builders get credits to start building.</p>
          </div>
          <RegisterSteps />
        </section>

        <section id="tracks" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={styles.disp}>Five tracks</h2>
            <p>Pick one track per entry. Every entry must deploy to Celo and use G$ somewhere real.</p>
          </div>
          <div className={styles.tracks}>
            {TRACKS.map((t) => {
              const Icon = TRACK_ICONS[t.icon];
              return (
                <SpotlightCard key={t.title} className={cn(styles.card, styles.trk)}>
                  <div className={styles.ic}>
                    <Icon size={26} strokeWidth={2} aria-hidden />
                  </div>
                  <div>
                    <h3>{t.title}</h3>
                    <p>{t.body}</p>
                  </div>
                  <span className={styles.ex}>{t.example}</span>
                </SpotlightCard>
              );
            })}
          </div>
        </section>

        <section id="timeline" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={styles.disp}>Timeline</h2>
            <p>All times West Africa Time. Dates are placeholders until confirmed.</p>
          </div>
          <div className={cn(styles.card, styles.pad32)}>
            <ol className={cn(styles.tl, "list-none p-0 m-0")}>
              {TIMELINE.map((t) => (
                <li key={t.when} className={cn(styles.node, t.now && styles.now)}>
                  <div className={styles.when}>{t.when}</div>
                  <h4>{t.title}</h4>
                  <p>{t.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="partners" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={styles.disp}>Backed by</h2>
            <p>The partners putting up the pool, the money rails and the tools. Want your name here? Partner slots are open.</p>
          </div>
          <div className={styles.partners}>
            {PARTNERS.map((p) => {
              const inner = (
                <>
                  {p.lead && (
                    <span className={styles.ghostmark} aria-hidden>
                      G$
                    </span>
                  )}
                  <span className={styles.role}>
                    {p.lead && <span className={styles.dot} />}
                    {p.role}
                  </span>
                  <div>
                    <div className={styles.wm}>
                      {p.name[0]}
                      {p.name[1] && (
                        <>
                          <br />
                          <span>{p.name[1]}</span>
                        </>
                      )}
                    </div>
                    <p>{p.body}</p>
                  </div>
                  <div className={styles.go}>
                    <span>{p.href ? "Visit" : "Link coming soon"}</span>
                    <span className={styles.disc}>
                      <ArrowRight size={16} aria-hidden />
                    </span>
                  </div>
                </>
              );
              const cls = cn(styles.card, styles.ptn, p.lead && styles.lead);
              return p.href ? (
                <a key={p.role} className={cls} href={p.href} target="_blank" rel="noreferrer">
                  {inner}
                </a>
              ) : (
                <div key={p.role} className={cls}>
                  {inner}
                </div>
              );
            })}
          </div>
          <div className={styles.strip}>
            <span>Become a partner and put your track in front of verified builders</span>
            <span>Partner slots open</span>
          </div>
        </section>

        <section id="rules" className={styles.section}>
          <div className={styles.split}>
            <div className={cn(styles.card, styles.pad32)}>
              <p className={styles.eyebrow}>Who can enter</p>
              <h2 className={cn(styles.disp, styles.rulesTitle)}>The rules</h2>
              <ul className={styles.rules}>
                {RULES.map((r) => (
                  <li key={r.text}>
                    <i>{r.ok ? <Check size={13} strokeWidth={3} aria-label="Allowed" /> : <X size={13} strokeWidth={3} aria-label="Not allowed" />}</i>
                    {r.text}
                  </li>
                ))}
              </ul>
            </div>
            <div className={cn(styles.card, styles.pad32, styles.faq)}>
              <p className={styles.eyebrow}>Questions</p>
              {FAQ.map((f, i) => (
                <details key={f.q} open={i === 0}>
                  <summary>
                    {f.q}
                    <span className={styles.pm}>
                      <Plus size={14} aria-hidden />
                    </span>
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <div className={styles.finale}>
          <div className={styles.orb} aria-hidden />
          <h2 className={styles.disp}>
            Your dApp.
            <br />
            Our <span>million.</span>
          </h2>
          <div className={styles.finaleRow}>
            <p>Registration takes about two minutes: connect, verify, build.</p>
            <a className={styles.cta} href="#register">
              Register to build
              <span className={styles.disc}>
                <ArrowRight size={18} aria-hidden />
              </span>
            </a>
          </div>
        </div>

        <footer className={styles.footer}>
          <span>{HACKATHON.name} · Built on Celo with GoodDollar</span>
          <span>18+ · Not open to US persons</span>
        </footer>
      </main>
    </div>
  );
}

function Poster() {
  return (
    <div className={styles.poster}>
      <PosterTiles className={styles.tiles} />
      <div className={styles.posterRow}>
        <span className={styles.tag}>
          <span className={styles.dot} />
          Registration open
        </span>
        <span className={styles.tag}>Build on Celo · {HACKATHON.window}</span>
      </div>
      <h1 className={cn(styles.disp, styles.posterTitle)} aria-label={`Build for ${fmtGd(HACKATHON.poolGd)} G$ in prizes`}>
        <span className={styles.line} aria-hidden>
          <span>Build for</span>
        </span>
        <span className={styles.line} aria-hidden>
          <span>
            <CountUp value={HACKATHON.poolGd} className={styles.big} />
          </span>
        </span>
        <span className={styles.line} aria-hidden>
          <span>
            G$ <span className={styles.faint}>in prizes</span>
          </span>
        </span>
      </h1>
      <div className={styles.posterFoot}>
        <p>The GoodBuild Million Hackathon. Ship a dApp on Celo that moves GoodDollar. Connect your wallet, verify once with GoodDollar, and get free build credits to start.</p>
        <a className={styles.cta} href="#register">
          Register to build
          <span className={styles.disc}>
            <ArrowRight size={18} aria-hidden />
          </span>
        </a>
      </div>
    </div>
  );
}

function PrizeCard({ prize: p }: { prize: Prize }) {
  const share = `${Math.round((p.amountGd / HACKATHON.poolGd) * 100)}%`;
  const amount = (
    <div className={styles.amt}>
      <CountUp value={p.amountGd} onView />
      <small>G$</small>
    </div>
  );
  if (p.id === "grand") {
    return (
      <div className={cn(styles.card, styles.prize, styles.pGrand)}>
        <span className={styles.rank} aria-hidden>
          1
        </span>
        <div>
          <p className={styles.eyebrow}>{p.label}</p>
          <p className={styles.prizeNote}>{p.note}</p>
        </div>
        <div>
          {amount}
          <div className={styles.bar}>
            <i style={{ width: share }} />
          </div>
          <p className={styles.share}>{share} of the pool</p>
        </div>
      </div>
    );
  }
  const half = p.id === "second" || p.id === "third";
  return (
    <div className={cn(styles.card, styles.prize, half ? styles.pHalf : styles.pThird)}>
      <div>
        <p className={styles.eyebrow}>{p.label}</p>
        {p.note && <p className={styles.prizeNote}>{p.note}</p>}
      </div>
      <div>
        {amount}
        <div className={styles.bar}>
          <i style={{ width: share }} />
        </div>
      </div>
    </div>
  );
}
