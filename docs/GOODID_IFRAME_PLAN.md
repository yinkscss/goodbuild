# GoodID face check in an iframe: plan (draft, not agreed)

Status: PLAN ONLY. Nothing is built. Proposed by Claude on 26 Nov 2026 after the owner pointed at GoodDrops, which already does this. Needs the owner's agreement before code; on agreement, record it in DECISIONS.md as the next D number (D171 at time of writing). Not touching D1 to D4.

## Goal
Let a person do GoodDollar's face scan in a dialog on our page instead of leaving the site, so the workspace, the hackathon page and the credits page keep their state. Today `useGoodIdVerify.verify()` signs a message and then does `window.location.assign(faceVerificationLink(...))`, and the return is handled by `verificationReturn()` reading `?isVerified` and a `sessionStorage` flag.

## What is known
- **Checked 24 Nov:** `https://goodid.gooddollar.org` sends no `X-Frame-Options` and no `frame-ancestors`. We set no CSP either.
- **Seen in the wild:** GoodDrops (public repo `Oshioke-Salaki/gooddropss`, `dapp/src/components/VerificationModal.tsx`) runs the same link in `<iframe allow="camera">`, with an "Open in new tab" fallback, and just polls `getWhitelistedRoot` every 5 s until the root is non-zero. No postMessage. No LICENSE file seen, so we take the approach, not the code.
- **Not verified:** camera in a frame on iOS Safari and in MiniPay or other wallet webviews; whether GoodDollar or its face-scan vendor allows being framed on purpose; browser storage partitioning inside the frame.

## Design
1. **Return page.** New tiny route `/verify/done` (no app chrome, no auth hooks, no storage use). GoodDollar's `rdu` points here when we open the frame. It does two things: `window.parent.postMessage({ type: "goodbuild:goodid-return", isVerified, reason }, location.origin)` and shows "You can close this". Reason: if the frame returned to the real page, a second copy of our app would run `verificationReturn()` and could consume the `?isVerified` hint and the `sessionStorage` flag that belong to the parent (same tab, same origin).
2. **Dialog.** Use `src/components/ui/dialog.tsx` (D12 tokens, no new style). Shows the three beats (allow camera, face scan, verified), the `<iframe allow="camera" title="GoodDollar face verification">`, a loading state, a "Camera not working? Open in new tab" link that does today's full-page redirect, and the existing link-guide note for "twin" results.
3. **Hook change** (`use-goodid-verify.ts`). `verify()` keeps the chain shortcut, the wallet check and the signature. After signing it chooses the mode: frame when supported, otherwise today's redirect. In frame mode it opens the dialog with `faceVerificationLink(..., returnTo = origin + "/verify/done")`. It listens for the postMessage (check `event.origin` and `event.source` is our frame) and also polls `/api/account/goodid` every 5 s as GoodDrops does, because the message is a hint and the chain decides (D30). On a verified result it closes the dialog and fires the existing `goodbuild:goodid-verified` event so every card updates.
4. **Mode choice.** Frame by default on desktop browsers. Redirect (today's path) for wallet webviews and iOS Safari until device tests pass. A single helper decides, so we can widen it later. An environment setting can switch frames off entirely.
5. **Keep as is.** `verificationReturn()` and the `pending` flag stay for the redirect path and the "Open in new tab" fallback.

## Steps
1. **Spike (about 1 hour, throwaway page, not committed).** Frame the real link and test desktop Chrome, Android Chrome, iOS Safari, MiniPay. Record results in this file. Stop here if the camera fails on most of them.
2. `/verify/done` route plus a test that it posts only to our own origin.
3. Frame dialog component (D12) with loading, fallback, twin and error states. Component tests.
4. Hook changes and tests: frame success, message hint with chain still not verified (keeps polling), reject from a foreign origin, close mid-scan, redirect mode unchanged.
5. Wire the four callers (workspace verify card, free credits card, add credits, hackathon and invite steps). They already share the hook.
6. Docs: HANDOFF.md, DECISIONS.md entry, and a note about the unverified devices.
7. Check on a local server at 1280 px and 390 px.

## Risks
- **GoodDollar can add a framing block any time.** Mitigation: the fallback to the redirect on frame load failure and a settings switch.
- **Camera refused in some webviews.** Mitigation: mode choice and the new-tab link.
- **Our message handler is a new input.** Mitigation: origin and source checks, and the chain read decides.
- **Clickjacking the other way:** we are the embedder, not the embedded, so no change to our own headers.

## Questions for the owner
1. Frame by default on desktop only, or try everywhere and rely on the fallback?
2. OK to ask GoodDollar whether framing is supported? (Not done yet; nothing was sent.)
3. Is the 1-hour device spike enough before we build, or should we wait for MiniPay testing?
