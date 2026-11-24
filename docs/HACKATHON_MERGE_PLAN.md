# Plan: one hackathon to 31 Dec (draft D170, amends D160, D161, D167)

Status: **Built (D170).** The owner dropped the campus prizes and kept the 1,000,000 G$ pool, ranked by approvals. Q2 to Q4 went with the defaults below. Written 24 Nov 2026.

## Goal
The FUTMinna and Kadpoly hackathons are merged into the main GoodBuild Hackathon. That leaves one hackathon with one leaderboard, closing **31 Dec 2026, end of day WAT** (`2026-12-31T23:00:00Z`). The rules stay the main hackathon's: the 1,000,000 G$ pool, the top 20 rank prizes, 3 approvals per verified person, and sign in + GoodDollar + FlowState vote. Old campus links redirect to the matching main page, and the hackathon switch is removed from the UI.

## What exists today (from the code scan)
- `src/lib/hackathon-events.ts` defines three events: `main` (`million-2027`, closes 10 Dec), `futminna` (`futminna-2026`, 10 Dec) and `kadpoly` (`kadpoly-2026`, 31 Dec).
- Every hackathon table stores the event id in its `hackathon` column: participants, entries, rank snapshots, registrations and referrals. Registrations and referrals are main-only already, and credits are one grant per person.
- Routes:
  - `/hackathon/{futminna,kadpoly}` are public campus pages built by `campus-page.tsx`.
  - `/home/hackathon/{futminna,kadpoly}/{,project,leaderboard,vote}` are the in-app pages built by `campus-app-pages.tsx`.
- The event is read from the path (`use-event.ts`) and sent to the API as `?event=`. The API reads it in projects, votes, participants and export.
- Other campus pieces in the UI:
  - the hackathon switch in `home-tabs.tsx`;
  - `GetStarted` redirecting campus members to their campus (D161);
  - the campus callouts on `/hackathon`;
  - the campus CSV buttons on `/hackathon/admin`;
  - the sitemap entries.
- `claimCloseFor` lets Kadpoly members claim until 31 Dec. Rising Star weeks 4 to 6 exist only for Kadpoly.

## Plan

### 1. One event in config
- `HACKATHON_EVENTS` keeps only `main`, with `closesAt` set to `2026-12-31T23:00:00Z` and `closesLabel` set to "31 Dec".
- The `event` parameters are kept for now and always resolve to `main`, so the type checker shows every place still left to change. A stray `?event=futminna` falls back to main.
- Delete `Campus`, `CAMPUS_EVENTS`, `campusOf`, `campusPicking` and `zoneBadge`'s campus branches.
- `CLAIMS_CLOSE` follows automatically. Claims, referral payouts, the credit expiry and the admin "closed" flag all move to 31 Dec for everyone, and `claimCloseFor` reduces to `CLAIMS_CLOSE`.
- Rising Star gets weeks 1 to 6 for everyone, because `weeksUntil` reads the close date.

### 2. Data migration `drizzle/0035_merge_hackathons.sql`, in one transaction
1. **Guard:** abort if any user has entries in more than one event. D160 should have prevented it.
2. **Participants**, which are unique on (hackathon, user):
   - Where a person has a main row, copy `flowstate='voted'` and its tx hash and time from any campus row into it, then delete the campus rows.
   - Where a person has no main row, relabel their campus row to `million-2027`. If they had both campus rows, keep the earliest.
3. **Entries:** relabel to `million-2027`. Approvals follow their entries, since they have no hackathon column.
4. **Rank snapshots:** relabel. Entry ids don't collide, and week 1 isn't finished, so no Rising Star result changes.
5. **Over-cap approvals:** someone who approved in two or three events may now hold up to 9 approvals against one cap of 3.
   - Recommended: keep them all, and allow no new approvals until the person is under 3.
   - The UI clamps "approvals left" at 0 (`vote-list.tsx` lines 102 and 364), so it never shows a negative number.

**Before deploy, the owner downloads the FUTMinna and Kadpoly CSVs** from `/hackathon/admin`. After the merge that split is gone, unless the campus tag below is kept.

### 3. Redirects (`redirects()` in `next.config.ts`, temporary 307)
| From | To |
|---|---|
| `/hackathon/futminna?vote=ID`, `/hackathon/kadpoly?vote=ID` | `/hackathon/projects?vote=ID` (D169 shared project links) |
| `/hackathon/futminna`, `/hackathon/kadpoly` | `/hackathon` |
| `/home/hackathon/futminna/:path*`, `/home/hackathon/kadpoly/:path*` | `/home/hackathon/:path*` |

The `?vote=` rule comes first. In the same change:
- Remove D161's campus-member redirect in `GetStarted` and the `?stay=1` escape. Otherwise campus members loop between the old and new pages.
- Remove the `gb:hk-vote:pending:<event>` keys.

### 4. Remove the campus UI
- **Delete:**
  - `src/app/hackathon/{futminna,kadpoly}`
  - `src/app/home/hackathon/{futminna,kadpoly}`
  - `campus-page.tsx`
  - `campus-app-pages.tsx`
  - `use-event.ts`
- **Edit:**
  - `home-tabs.tsx`: remove the switch.
  - `/hackathon/page.tsx`: remove the campus callouts.
  - `/hackathon/admin`: remove the campus CSV buttons.
  - `sitemap.ts`: remove the campus URLs.
  - `get-started.tsx`, `ladder.tsx`, `community.tsx`, `vote-list.tsx`, `register-steps.tsx`, `project-vote-link.tsx`: drop the event lookups.
  - `saveEntry`: remove the "already entered in another hackathon" check.
- Old blog posts stay as written, and their links redirect.

### 5. One leaderboard, one set of dates
- The leaderboard is `/home/hackathon/leaderboard` in the app and `/hackathon#leaderboard` plus `/hackathon/projects` on the public site. All of them show every project, ranked together, with the top 20 prize zone and G$ estimates.
- Update the dates in `content.ts`:
  - the window becomes "18 Nov to 31 Dec 2026";
  - the timeline and FAQ change to match;
  - the 12 Dec line on `/hackathon` and the leaderboard page copy change too.
- Rising Star labels change to match.

### 6. Tests and docs
- Rewrite the campus tests to cover the single event:
  - `hackathon-events`
  - `events`
  - `ladder`
  - `get-started`
  - `register-steps`
  - `home-tabs`
  - `export`
  - `admin`
  - `blog`
- Add a PGlite migration test. It seeds a user with main and FUTMinna rows where only the campus row is voted, a Kadpoly entry, one root with 3 main and 3 FUTMinna approvals, and campus snapshots. It then checks the end state.
- Check every redirect in the browser pane, `?vote=` included.
- Docs: D170 in `DECISIONS.md`, a `HANDOFF.md` entry, and README if it names the campuses.

## Open questions for the owner
1. **Campus prizes.** Is the FUTMinna ₦150,000 scholarship and the Kadpoly full tuition for the top 3 dropped? Or is it still awarded to the best FUTMinna or Kadpoly students on the combined leaderboard? If kept, a `campus` tag is saved on each participant before the migration, and the leaderboard shows a small school badge.
2. **Dates after the close.** What replaces "submit by 5 Dec for a fair vote" and "winners announced 12 Dec"? Until confirmed, they are marked DRAFT, for example "winners announced early January".
3. **"Single page" means one combined leaderboard.** The tabs Get started, My project, Leaderboard and Vote stay as they are. Say so if you meant folding those tabs into one page.
4. **Over-cap approvals:** keep them all (recommended), or trim each person back to their first 3?
