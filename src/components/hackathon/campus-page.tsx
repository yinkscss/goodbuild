import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { WalletButton } from "@/components/auth/wallet-button";
import { LogoMark } from "@/components/brand/logo";
import "@/components/hackathon/hackathon.css";
import { styles } from "@/components/hackathon/styles";
import { Ladder } from "@/components/hackathon/ladder";
import { VoteList } from "@/components/hackathon/vote-list";
import { PosterTiles } from "@/components/hackathon/poster-tiles";
import { RegisterSteps } from "@/components/hackathon/register-steps";
import { SITE_URL } from "@/config/site-url";
import { campusOf, HACKATHON_EVENTS, type CampusEvent } from "@/lib/hackathon-events";
import { cn } from "@/lib/utils";

/** The page metadata of a campus hackathon (D160, D167). */
export function campusMetadata(event: CampusEvent): Metadata {
  const { name, page } = HACKATHON_EVENTS[event];
  const c = campusOf(event);
  return {
    title: { absolute: `${name} · ${c.prizeTitle} · GoodBuild` },
    description: `Build a GoodDollar app or game with GoodBuild and win ${c.prize}. For ${c.short} students. Verify with GoodDollar, get free build credits, and gather approvals.`,
    alternates: { canonical: `${SITE_URL}${page}` },
    openGraph: { title: name, description: `Build a GoodDollar app or game. Win ${c.prize}.` },
  };
}

const NAV = [
  { href: "#scholarship", label: "Scholarship" },
  { href: "#how", label: "How to enter" },
  { href: "#register", label: "Register" },
  { href: "#leaderboard", label: "Leaderboard" },
  { href: "#vote", label: "Vote" },
  { href: "#rules", label: "Rules" },
];

const STEPS = [
  {
    title: "Get verified",
    body: "Do GoodDollar’s free face check once. It proves you’re one real person. Only verified GoodDollar users can enter.",
  },
  {
    title: "Build with GoodBuild",
    body: "Describe your dApp or game in chat. GoodBuild writes the smart contract and the app, and you deploy it to Celo mainnet from your own wallet.",
  },
  {
    title: "Make G$ matter",
    body: "Your app or game needs a meaningful GoodDollar (G$) integration: G$ is part of what it does, not just a logo.",
  },
];

const IDEAS = ["Games", "G$ payments", "Tips and donations", "Savings circles", "Rewards and quests", "Marketplaces"];

const COUNT = ["None", "One", "Two", "Three", "Four", "Five"];

function rulesOf(event: CampusEvent): string[] {
  const { zone, closesLabel } = HACKATHON_EVENTS[event];
  const c = campusOf(event);
  return [
    `Open to ${c.short} students aged 18+. Not open to US persons.`,
    "Entrants must be verified GoodDollar users.",
    "Your app or game must be built with GoodBuild and have a meaningful G$ integration.",
    "Your project must be live on Celo mainnet.",
    "Judges look for something creative that solves a real problem, and it must be published.",
    `Each builder enters one hackathon: ${c.short}, the main GoodBuild hackathon or another campus’s, not more than one.`,
    ...(c.judged
      ? [
          `Verified people approve projects. The top ${zone} by approvals make the shortlist.`,
          `${c.judges} pick the ${c.prizeTitle} winner from the shortlist after voting closes on ${closesLabel}.`,
          `The winner shows they’re a ${c.short} student before the scholarship is paid.`,
        ]
      : [
          "Verified people approve projects. Ties go to the earlier submission.",
          `When voting closes on ${closesLabel}, the top ${c.winners} by approvals each win ${c.prize}. Places ${c.winners + 1} ${zone - c.winners === 2 ? "and" : "to"} ${zone} are waitlisted.`,
          `Winners show they’re ${c.short} students before the scholarship is paid. If a winner can’t, the next on the waitlist takes their place.`,
        ]),
  ];
}

/** A campus hackathon (D160 FUTMinna, D167 Kadpoly): its own entries, leaderboard and approvals; the main hackathon's signup and credits. */
export function CampusHackathonPage({ event }: { event: CampusEvent }) {
  const { name, app, zone } = HACKATHON_EVENTS[event];
  const c = campusOf(event);
  const picking = c.judged
    ? `the top ${zone} make the shortlist, and ${c.judges} pick the winner.`
    : `the top ${c.winners} win and the next ${zone - c.winners} are waitlisted.`;
  return (
    <div className={styles.page}>
      <header className={cn(styles.nav, styles.wrap)}>
        <div className={styles.navbar}>
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-full" aria-label="GoodBuild home">
            <LogoMark />
            <span className="text-[17px] font-semibold tracking-tight">GoodBuild</span>
            <span className={styles.brandTag}>{c.tag}</span>
          </Link>
          <nav aria-label={name} className={styles.navlinks}>
            {NAV.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className={styles.navWallet}>
            <WalletButton showNetwork={false} />
          </div>
        </div>
      </header>

      <main className={styles.wrap}>
        <div className={styles.poster}>
          <PosterTiles className={styles.tiles} />
          <div className={styles.posterRow}>
            <span className={styles.tag}>
              <span className={styles.dot} />
              Now live
            </span>
            <span className={styles.tag}>{c.short} students · {c.dates}</span>
          </div>
          <h1 className={cn(styles.disp, styles.posterTitle, "hk-fit")}>
            <span className={styles.line}><span>Build a GoodDollar</span></span>
            <span className={styles.line}><span>app or game.</span></span>
            <span className={styles.line}><span><span className={styles.big}>{c.posterWin}</span></span></span>
          </h1>
          <div className={styles.posterFoot}>
            <p>
              The {name} by GoodBuild and GoodCash. Build with GoodBuild, put G$ at the heart of it, and win {c.prize}.
            </p>
            <a className={styles.cta} href="#register">
              Register to build
              <span className={styles.disc}>
                <ArrowRight size={18} aria-hidden />
              </span>
            </a>
          </div>
        </div>

        <section id="scholarship" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={cn(styles.disp, "hk-fit")}>{c.winners === 1 ? "The scholarship" : "The scholarships"}</h2>
            <p>
              {c.prizeLine} Votes rank the leaderboard; {picking}
            </p>
          </div>
          <div className={cn(styles.card, styles.pad32, "flex flex-wrap items-center justify-between gap-6 !bg-violet !text-white")}>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-white/70">Scholarship</p>
              <p className="mt-2 text-[56px] font-extrabold leading-none tracking-tight sm:text-[80px]">{c.prizeHeadline}</p>
              <p className="mt-3 text-lg text-white/85">{c.prizeNote}</p>
            </div>
            <div className="flex items-center gap-4 rounded-block bg-white/10 p-4">
              <LogoMark />
              <span aria-hidden className="text-white/60">×</span>
              <Image src="/partners/goodcash.png" alt="GoodCash" width={44} height={44} className="rounded-lg" />
            </div>
          </div>
        </section>

        <section id="how" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={cn(styles.disp, "hk-fit")}>How to enter</h2>
            <p>Three rules. {COUNT[c.winners] ?? c.winners} {c.winners === 1 ? "winner" : "winners"}.</p>
          </div>
          <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className={cn(styles.card, styles.pad32)}>
                <span className="display inline-flex size-12 items-center justify-center rounded-block bg-tint text-lg font-extrabold text-violet">
                  0{i + 1}
                </span>
                <h3 className="display mt-4 text-xl font-bold uppercase">{s.title}</h3>
                <p className="mt-2 text-grey-600">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            {IDEAS.map((idea) => (
              <span key={idea} className="rounded-full bg-tint px-3.5 py-1.5 text-[13px] font-medium text-violet">
                {idea}
              </span>
            ))}
          </div>
        </section>

        <section id="register" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={cn(styles.disp, "hk-fit")}>
              Register in
              <br />
              four easy steps
            </h2>
            <p>
              Use your email to create a wallet, verify with GoodDollar, vote for GoodBuildIt and GoodCash on FlowState, then claim free
              build credits. Already registered for the main hackathon? Your credits carry over; you just enter your project here.
            </p>
          </div>
          <RegisterSteps />
          <div className={styles.strip}>
            <Link href={`${app}/project`}>Enter or update your {c.short} project →</Link>
          </div>
        </section>

        <section id="leaderboard" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={cn(styles.disp, "hk-fit")}>{c.short} leaderboard</h2>
            <p>
              Only {c.short} projects.{" "}
              {c.judged
                ? `The top ${zone} by verified approvals make the shortlist.`
                : `The top ${c.winners} by verified approvals win; the next ${zone - c.winners} are waitlisted.`}
            </p>
          </div>
          <div className={cn(styles.card, styles.pad32)}>
            <Ladder mode="web" />
          </div>
        </section>

        <section id="vote" className={styles.section}>
          <div className={styles.shead}>
            <h2 className={cn(styles.disp, "hk-fit")}>Vote for a project</h2>
            <p>
              Anyone verified with GoodDollar can vote. You get 3 {c.short} approvals, separate from the main hackathon’s. Put them all on
              one project or spread them around.
            </p>
          </div>
          <VoteList />
        </section>

        <section id="rules" className={styles.section}>
          <div className={cn(styles.card, styles.pad32)}>
            <p className={styles.eyebrow}>Who can enter</p>
            <h2 className={cn(styles.disp, styles.rulesTitle)}>The rules</h2>
            <ul className={styles.rules}>
              {rulesOf(event).map((r) => (
                <li key={r}>
                  <i>
                    <Check size={13} strokeWidth={3} aria-hidden />
                  </i>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className={styles.footer}>
          <span>{name} · GoodBuild × GoodCash · Built on Celo with GoodDollar</span>
          <span>18+ · Not open to US persons</span>
        </footer>
      </main>
    </div>
  );
}
