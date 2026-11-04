# GoodBuild Design System (light bento)

**Status: fixed user decision D12.** Claude must follow this doc for all GoodBuild UI: the marketing site, the builder workspace and default styling. The reference is [design/landing/index.html](../design/landing/index.html) (screenshot: `design/landing/hero.png`). The dark exploration in `design/landing/explorations/mockup-a/` is archive only. Don't use it.

Mood: calm, bright, engineered. White cards on light grey, one deep violet, a rare flash of pink, and big extended all-caps headlines. It should feel like a precise instrument, not a crypto casino.

## 1. Tokens

### Colour
| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F5F5F5` | Page background |
| `surface` | `#FFFFFF` | Cards, panels, inputs |
| `surface-tint` | `#F3EEF8` | Chips, subtle selected states, code-tab bar |
| `violet` (primary) | `#592E81` | Primary actions, links, key numbers, focus rings |
| `violet-ink` | `#1A0D26` | Display headlines on tinted surfaces |
| `violet-soft` | `#EFE6F7` → `#E2D2F0` | Hero radial gradient stops |
| `pink` (pop) | `#FF85D9` | Charts, live dots, the CTA arrow disc. **Max one or two pink moments per screen.** Never use it for text on white (contrast fails). |
| `ink` | `#111111` | Body text, black CTA pill (`Connect wallet`) |
| `grey-600` | `rgba(17,17,17,.55)` ≈ `#7A7A7A` | Secondary text |
| `grey-400` | `rgba(17,17,17,.35)` ≈ `#A6A6A6` | Placeholders, axis labels |
| `hairline` | `rgba(17,17,17,.05)` | Internal dividers only, never card borders |
| `success` | `#1F9D6B` | Deploy success, verified |
| `warning` | `#C77700` | Low credits |
| `danger` | `#D2384B` | Errors, failed transactions |

### Type
- **Display:** Unbounded 700/800, ALL CAPS, `letter-spacing: -0.03em`, `line-height: .95`. Syne 700/800 is the fallback. Sizes: 58px hero, 40px section, 28px modal title. Use display type only for headlines and big numbers, never for paragraphs or buttons.
- **Body/UI:** Inter 400/500/600. Sizes: 18 (prompt), 16 (body), 14 (UI default), 13 (chips), 11–12 (eyebrows, uppercase, `tracking .18em`, weight 600, violet).
- **Code:** JetBrains Mono 13px.

### Radii
`card 24px` · `panel/modal 24px` · `inner block 16px` · `input 16px` · `button/chip/pill 9999px` · `tooltip 10px`.

### Shadows (no borders on cards)
- `shadow-card`: `0 1px 2px rgba(17,17,17,.03), 0 18px 50px -24px rgba(89,46,129,.18)`
- `shadow-pop` (modals, popovers): `0 2px 6px rgba(17,17,17,.04), 0 40px 80px -30px rgba(89,46,129,.30)`
- `shadow-focus`: `0 0 0 4px rgba(89,46,129,.14)`

### Spacing
Base 4px. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. Bento gap **16px**. Card padding **24px** (32px for feature cards). Page side padding **32px**, max width **1360px**. Space between sections: 96px.

## 2. Bento grid rules
- Desktop hero: `grid-cols-[1fr_2.1fr_1fr]`, gap 16px, row height about 520px. The centre card is always the widest and holds the image and headline. Side cards hold one idea each: a metric, or an object with text.
- Every card has one job: one eyebrow, one headline or number, at most two lines of support text.
- Cards align to a shared baseline at the bottom. No ragged bottoms and no dead white gaps. If content is short, enlarge the visual or use `justify-between`.
- Tablet: 2 columns, with the centre card spanning both. Mobile: 1 column, ordered centre card, prompt box, metric, object.
- At most one coloured (violet) card per row, used to emphasise the final step or CTA.

## 3. Components
- **Primary button:** black pill (`bg ink`, white text, 14/500, `px-6 py-3`). Used for `Connect wallet` and other top-level commits.
- **Action button:** violet pill with a pink 32px arrow disc on the right (`Build it →`). One per view.
- **Secondary:** white pill with `shadow-card`. **Ghost:** text-only violet. No outline buttons with grey borders.
- **Input:** white, radius 16, no border. On focus: `shadow-focus`. Placeholder in grey-400.
- **Chip:** `surface-tint` background, violet text, 13/500, `px-3.5 py-1.5`, pill. Selected: violet background, white text.
- **Card:** white, radius 24, `shadow-card`, padding 24. No borders and no gradients except the hero card's radial violet.
- **Charts:** a single pink 3px line with round caps, filled with a vertical gradient from pink at 45% to 0%. Gridlines are hairlines only, and there are no axes boxes. Show the big number above in display type, with the delta in violet. Draw the line in on mount (≤2.4s) and pulse the last point.
- **Prompt box (hero centrepiece):** must be richer than the mockup. Use a large white card with an 18px textarea that auto-grows (2 to 8 rows). Its toolbar has:
  - attach (image or sketch)
  - a template picker
  - a network toggle (`Celo Sepolia` / `Celo`; Alfajores was retired 30 Sep 2025, see P1)
  - example chips: `G$ savings circle`, `Community tip jar`, `Event tickets on Celo`
  - a `credits: 120 G$` hint
  - the violet `Build it` send button

  Show a typing caret hint and an "Enhance prompt" sparkle ghost button. Cmd/Ctrl+Enter submits.
- **Credits pill:** white pill with a G$ glyph and the balance (`120 G$`). At ≤10 G$ it turns warning-tinted with a top-up link; at 0 the send button is disabled with an inline "Top up to keep building".
- **Wallet states (nav, right):**
  - Disconnected: black pill `Connect wallet`.
  - Connecting: the same pill with a spinner and "Check your wallet".
  - Connected: white pill with a pink dot, the shortened address and the Celo badge.
  - Wrong network: warning pill "Switch to Celo".

## 4. Builder workspace
Layout: nav (logo, project name, credits pill, wallet pill) above a two-pane split on the `canvas` background with 16px gaps. Both panes are cards.
- **Chat panel (left, 420px):** white card. User messages go right-aligned in `surface-tint` bubbles (radius 16). AI messages are plain text with no bubble, and each one is followed by collapsible **step rows** ("Writing SavingsCircle.sol ✓", "Compiling", "Generating UI") with tiny status dots. The prompt box is pinned at the bottom in a compact version with the same toolbar.
- **Preview / Code (right):** a card with a pill tab switcher (`Preview` · `Code` · `Contract`) in a `surface-tint` track.
  - Preview is a Sandpack iframe inside a 16px-radius inner frame, with a device toggle (desktop/mobile).
  - Code is Sandpack's editor themed light: white background, violet keywords, pink strings used sparingly, grey comments, JetBrains Mono, and a file tree on the left in grey-600.
- **Deploy modal:** 560px, radius 24, `shadow-pop`. Title in display type ("DEPLOY TO CELO"). It shows a summary list (contract, network, estimated gas in CELO, credit cost in G$) and a three-step progress stepper: Sign → Broadcast → Verified. The black primary button reads `Sign & deploy`.
- **States:**
  - Loading: skeleton cards in `surface-tint` with a soft shimmer, plus step rows. Never a full-screen spinner.
  - Empty: a centred chrome object illustration, one sentence and three example chips.
  - Error: an inline card with a danger dot, a plain-language cause, a `Try fix` violet button and expandable logs. No red full-bleed banners.
  - Low credit: the warning credits pill and an inline top-up card in the chat.
  - Deploy success: a modal with a success check and the contract address with copy and explorer link. Use one pink confetti or glow burst (once, under 1.2s), plus a `Share app` button.

## 5. Motion
- Subtle and purposeful: 150–250ms UI transitions with `cubic-bezier(.2,.8,.2,1)`, 6s idle bobs on hero imagery, and a draw-in for charts.
- **React Bits only for the hero (landing), loaders and empty states.** Don't use it in the editor, forms or modals.
- Respect `prefers-reduced-motion`: turn off bobs, shimmer and confetti.

## 6. Tailwind and shadcn mapping
```js
// tailwind.config.js
module.exports = {
  theme: { extend: {
    colors: {
      canvas: '#F5F5F5', surface: '#FFFFFF', tint: '#F3EEF8',
      violet: { DEFAULT: '#592E81', ink: '#1A0D26', soft: '#EFE6F7', mist: '#E2D2F0' },
      pink: { DEFAULT: '#FF85D9' }, ink: '#111111',
      success: '#1F9D6B', warning: '#C77700', danger: '#D2384B',
    },
    fontFamily: { display: ['Unbounded','Syne','sans-serif'], sans: ['Inter','sans-serif'], mono: ['JetBrains Mono','monospace'] },
    borderRadius: { card: '24px', block: '16px', tip: '10px' },
    boxShadow: {
      card: '0 1px 2px rgba(17,17,17,.03), 0 18px 50px -24px rgba(89,46,129,.18)',
      pop: '0 2px 6px rgba(17,17,17,.04), 0 40px 80px -30px rgba(89,46,129,.30)',
      focus: '0 0 0 4px rgba(89,46,129,.14)',
    },
    transitionTimingFunction: { gb: 'cubic-bezier(.2,.8,.2,1)' },
  } },
};
```
```css
/* globals.css: shadcn variables (HSL) */
:root {
  --background: 0 0% 96%;        /* #F5F5F5 */
  --foreground: 0 0% 7%;         /* #111 */
  --card: 0 0% 100%;  --card-foreground: 0 0% 7%;
  --popover: 0 0% 100%; --popover-foreground: 0 0% 7%;
  --primary: 271 47% 34%;        /* #592E81 */
  --primary-foreground: 0 0% 100%;
  --secondary: 273 45% 95%;      /* #F3EEF8 */
  --secondary-foreground: 271 47% 34%;
  --muted: 273 45% 95%; --muted-foreground: 0 0% 45%;
  --accent: 318 100% 76%;        /* #FF85D9, pop only */
  --accent-foreground: 275 50% 10%;
  --destructive: 353 62% 52%; --destructive-foreground: 0 0% 100%;
  --border: 0 0% 7% / 0.05; --input: 0 0% 100%; --ring: 271 47% 34%;
  --radius: 1.5rem;              /* 24px cards; use rounded-full for buttons */
}
```

## 7. Don't look "vibe coded"
**Do**
- Keep to one primary (violet) and one pop (pink), and count the pink moments on each screen.
- Write real, specific copy ("Weekly G$ savings circle for 12 members"), never lorem or "Unleash the power of AI".
- Align everything to the grid and the 4px scale, and keep card bottoms flush.
- Use bespoke 3D or chrome art and real numbers in metrics.
- Give every state (loading, empty, error) a designed treatment.

**Don't**
- Purple-to-blue gradients on everything, glassmorphism on light backgrounds, or neon glows.
- Emoji as icons, mixed icon sets, or default shadcn grey borders on every card.
- Centred-everything hero sections with three identical feature cards and generic stock illustrations.
- Gradient text, rainbow badges, `animate-bounce`, or motion in the editor.
- Display caps for body text or buttons. More than two font families.

## 8. Known fixes vs the mockup
1. ~~Replace the hero render with a more "building" image.~~ **Dropped (user, 4 Nov 2026):** keep `design/landing/assets/hero-b.jpg` as the hero render, on the white-to-violet radial gradient.
2. **Close the gap in the right card:** enlarge the chrome cube and anchor the text to the bottom so there's no dead white space.
3. **Make the prompt box richer:** add the toolbar described in section 3 (attach, template, network toggle, enhance, credits, send).
