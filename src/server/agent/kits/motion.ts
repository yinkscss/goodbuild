import type { Kit } from "./registry";

/**
 * The motion kit (D84): the animated pieces that make a page feel designed, written for GoodBuild
 * with no package behind them. D7 asked for "shadcn/ui + React Bits" in generated apps and only the
 * first half was ever there: an app could not fade a section in, count a number up or put a glow
 * behind a hero without the builder hand-writing an animation, which it does badly and differently
 * every time.
 *
 * Why not React Bits itself, or the motion package: React Bits is MIT with the Commons Clause, which
 * forbids selling a product whose value comes substantially from it, and GoodBuild sells builds.
 * The motion package measured 44 kB gzipped for one animated element (130 kB minified, 10 Nov 2026),
 * about as much again as a whole starter app, and the people these apps are for are on phones and
 * data plans. So these are original components in the same spirit: CSS transitions and keyframes, an
 * IntersectionObserver and pointer events. The whole kit, every piece used, measured 3.5 kB gzipped
 * (2.4 kB of script, 1.0 kB of styles). It needs nothing the in-browser preview lacks: its only
 * import beyond React is a stylesheet, the way the starter's main.tsx imports styles.css.
 *
 * Every piece stops moving under prefers-reduced-motion, and nothing stays hidden if the browser
 * can't run it. GoodBuild's own screenshots set data-fx="off" on <html>, which shows everything in
 * its final state, so a section that hasn't been scrolled to isn't reported as blank.
 */

const FX_CSS = `/* GoodBuild motion kit. Everything here stops under prefers-reduced-motion, and under
   html[data-fx="off"], which GoodBuild sets when it takes a screenshot of the page. */

.fx-reveal {
  opacity: 0;
  transform: var(--fx-from, translate3d(0, 24px, 0));
  filter: var(--fx-blur, none);
  transition:
    opacity var(--fx-dur, 0.7s) cubic-bezier(0.22, 1, 0.36, 1) var(--fx-delay, 0s),
    transform var(--fx-dur, 0.7s) cubic-bezier(0.22, 1, 0.36, 1) var(--fx-delay, 0s),
    filter var(--fx-dur, 0.7s) cubic-bezier(0.22, 1, 0.36, 1) var(--fx-delay, 0s);
  will-change: opacity, transform;
}
.fx-reveal[data-shown="true"] {
  opacity: 1;
  transform: none;
  filter: none;
}

.fx-marquee {
  display: flex;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
}
.fx-marquee-track {
  display: flex;
  flex-shrink: 0;
  min-width: 100%;
  align-items: center;
  justify-content: space-around;
  gap: var(--fx-gap, 3rem);
  padding-right: var(--fx-gap, 3rem);
  animation: fx-marquee var(--fx-dur, 30s) linear infinite;
}
.fx-marquee[data-reverse="true"] .fx-marquee-track {
  animation-direction: reverse;
}
.fx-marquee[data-pause="true"]:hover .fx-marquee-track {
  animation-play-state: paused;
}
@keyframes fx-marquee {
  to {
    transform: translate3d(-100%, 0, 0);
  }
}

.fx-gradient-text {
  background-image: linear-gradient(90deg, var(--fx-a), var(--fx-b), var(--fx-a));
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: fx-shine var(--fx-dur, 6s) linear infinite;
}
@keyframes fx-shine {
  to {
    background-position: 200% center;
  }
}

.fx-rotating {
  display: inline-block;
  animation: fx-rotate-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes fx-rotate-in {
  from {
    opacity: 0;
    transform: translate3d(0, 0.5em, 0);
    filter: blur(6px);
  }
}

.fx-aurora {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.fx-aurora > span {
  position: absolute;
  width: 55%;
  aspect-ratio: 1;
  border-radius: 9999px;
  filter: blur(72px);
  opacity: var(--fx-strength, 0.35);
  animation: fx-drift var(--fx-dur, 18s) ease-in-out infinite alternate;
}
.fx-aurora > span:nth-child(1) {
  left: -12%;
  top: -22%;
  background: var(--fx-a);
}
.fx-aurora > span:nth-child(2) {
  right: -14%;
  top: 4%;
  background: var(--fx-b);
  animation-delay: -6s;
  animation-direction: alternate-reverse;
}
.fx-aurora > span:nth-child(3) {
  left: 22%;
  bottom: -38%;
  background: var(--fx-c);
  animation-delay: -11s;
}
@keyframes fx-drift {
  from {
    transform: translate3d(-6%, -4%, 0) scale(1);
  }
  to {
    transform: translate3d(9%, 7%, 0) scale(1.2);
  }
}

.fx-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  -webkit-mask-image: radial-gradient(ellipse at 50% 0%, #000 0%, transparent 72%);
  mask-image: radial-gradient(ellipse at 50% 0%, #000 0%, transparent 72%);
}

.fx-spotlight {
  position: relative;
  overflow: hidden;
}
.fx-spotlight::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
  background: radial-gradient(var(--fx-size, 320px) circle at var(--fx-x, 50%) var(--fx-y, 50%), var(--fx-glow), transparent 70%);
}
.fx-spotlight:hover::before,
.fx-spotlight:focus-within::before {
  opacity: 1;
}

.fx-tilt {
  transform: perspective(900px) rotateX(var(--fx-rx, 0deg)) rotateY(var(--fx-ry, 0deg));
  transition: transform 0.25s ease-out;
  transform-style: preserve-3d;
  will-change: transform;
}

.fx-magnetic {
  display: inline-block;
  transform: translate3d(var(--fx-mx, 0px), var(--fx-my, 0px), 0);
  transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.fx-float {
  animation: fx-float var(--fx-dur, 6s) ease-in-out infinite;
}
@keyframes fx-float {
  50% {
    transform: translate3d(0, -10px, 0);
  }
}

html[data-fx="off"] .fx-reveal {
  opacity: 1 !important;
  transform: none !important;
  filter: none !important;
  transition: none !important;
}
html[data-fx="off"] .fx-marquee-track,
html[data-fx="off"] .fx-gradient-text,
html[data-fx="off"] .fx-aurora > span,
html[data-fx="off"] .fx-rotating,
html[data-fx="off"] .fx-float {
  animation: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .fx-reveal {
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
    transition: none !important;
  }
  .fx-marquee-track,
  .fx-gradient-text,
  .fx-aurora > span,
  .fx-rotating,
  .fx-float {
    animation: none !important;
  }
  .fx-tilt,
  .fx-magnetic {
    transform: none !important;
  }
}
`;

const REVEAL = `import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./fx.css";

/** True when the person asked their device for less motion. Effects check it and hold still. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * ref for an element, and inView: true once any of it has scrolled onto the screen. It stays true
 * unless once is false. A browser that can't watch for it says true straight away, so nothing
 * that waits on this can stay hidden.
 */
export function useInView<T extends Element = HTMLDivElement>(options: { once?: boolean } = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const once = options.once ?? true;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) setInView(false);
        }
      },
      // Any part of it counts (a tall section never reaches a share of itself on a short screen),
      // a little above the bottom edge so the movement is seen.
      { threshold: 0, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);
  return { ref, inView };
}

/**
 * True while GoodBuild is taking a picture of the page (it sets data-fx="off" on <html>). Pieces that
 * animate in script, not CSS, use it to show their final state.
 */
export function useFxOff(): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setOff(root.getAttribute("data-fx") === "off");
    read();
    if (typeof MutationObserver === "undefined") return;
    const watcher = new MutationObserver(read);
    watcher.observe(root, { attributes: true, attributeFilter: ["data-fx"] });
    return () => watcher.disconnect();
  }, []);
  return off;
}

export type RevealFrom = "up" | "down" | "left" | "right" | "scale" | "none";

const FROM: Record<RevealFrom, string> = {
  up: "translate3d(0, 24px, 0)",
  down: "translate3d(0, -24px, 0)",
  left: "translate3d(-32px, 0, 0)",
  right: "translate3d(32px, 0, 0)",
  scale: "scale(0.94)",
  none: "none",
};

/**
 * Fades its children in as they scroll onto the screen, once. from: where they come from
 * ("up" by default). delay and duration are in seconds. blur adds a soft focus-in.
 */
export function Reveal({
  children,
  from = "up",
  delay = 0,
  duration = 0.7,
  blur = false,
  className,
  style,
}: {
  children: ReactNode;
  from?: RevealFrom;
  delay?: number;
  duration?: number;
  blur?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const vars = { "--fx-from": FROM[from], "--fx-delay": delay + "s", "--fx-dur": duration + "s", "--fx-blur": blur ? "blur(10px)" : "none" } as CSSProperties;
  return (
    <div ref={ref} data-shown={inView} className={"fx-reveal" + (className ? " " + className : "")} style={{ ...vars, ...style }}>
      {children}
    </div>
  );
}

/**
 * Reveals each child a moment after the one before it: a row of cards, a list of steps. Each child
 * is wrapped in its own block, so give Stagger the grid or flex classes (className) and it lays the
 * wrapped children out. gap is the seconds between one child and the next.
 */
export function Stagger({
  children,
  gap = 0.08,
  from = "up",
  className,
  itemClassName,
}: {
  children: ReactNode;
  gap?: number;
  from?: RevealFrom;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div className={className}>
      {Children.toArray(children).map((child, i) => (
        <Reveal key={i} from={from} delay={Math.min(i, 8) * gap} className={itemClassName}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
`;

const TEXT = `import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./fx.css";
import { prefersReducedMotion, useFxOff, useInView } from "./Reveal";

type TextTag = "h1" | "h2" | "h3" | "p" | "span" | "div";

/**
 * A headline that arrives word by word (or letter by letter), each piece fading up out of a blur.
 * Use it once per page, on the hero headline. Screen readers hear the whole sentence once.
 */
export function SplitText({
  text,
  as = "h1",
  by = "word",
  gap = 0.06,
  delay = 0,
  className,
}: {
  text: string;
  as?: TextTag;
  by?: "word" | "letter";
  /** Seconds between one piece and the next. */
  gap?: number;
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLElement>();
  const words = text.split(" ");
  let n = 0;
  const piece = (content: string, key: string) => {
    const style = { display: "inline-block", "--fx-delay": delay + Math.min(n++, 40) * gap + "s", "--fx-from": "translate3d(0, 0.35em, 0)", "--fx-blur": "blur(8px)", "--fx-dur": "0.6s" } as CSSProperties;
    return (
      <span key={key} data-shown={inView} className="fx-reveal" style={style}>
        {content}
      </span>
    );
  };
  // A plain space between the words, so the line wraps where a sentence would.
  const children: ReactNode[] = [];
  words.forEach((word, w) => {
    if (w > 0) children.push(" ");
    children.push(
      // Letters stay inside their word, so a line never breaks in the middle of one.
      <span key={w} aria-hidden="true" style={{ display: "inline-block", whiteSpace: "nowrap" }}>
        {by === "letter" ? Array.from(word).map((letter, l) => piece(letter, w + ":" + l)) : piece(word, String(w))}
      </span>,
    );
  });
  return createElement(as, { ref, className, "aria-label": text }, children);
}

/**
 * Text filled with a slow moving gradient. from and to are CSS colours; they default to the theme's
 * accent and primary. For a few words inside a headline, not a paragraph.
 */
export function GradientText({
  children,
  from = "var(--color-accent, #7c3aed)",
  to = "var(--color-primary, #0f172a)",
  seconds = 6,
  className,
}: {
  children: string;
  from?: string;
  to?: string;
  seconds?: number;
  className?: string;
}) {
  const style = { "--fx-a": from, "--fx-b": to, "--fx-dur": seconds + "s" } as CSSProperties;
  return (
    <span className={"fx-gradient-text" + (className ? " " + className : "")} style={style}>
      {children}
    </span>
  );
}

/**
 * One word of a sentence that changes every few seconds: "Save with <RotatingText words={["friends",
 * "family", "your team"]} />". Screen readers get the first word and are not interrupted.
 */
export function RotatingText({ words, seconds = 2.4, className }: { words: string[]; seconds?: number; className?: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (words.length < 2 || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % words.length);
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [words.length, seconds]);
  const word = words[index % Math.max(words.length, 1)] ?? "";
  return (
    <span className={className} aria-label={words[0]}>
      <span key={word} aria-hidden="true" className="fx-rotating">
        {word}
      </span>
    </span>
  );
}

/**
 * A number that counts up to its value when it scrolls onto the screen. Give it a REAL number (from
 * the contract or the app's data), never one made up to look good. format turns the running number
 * into text (for example compact amounts); the default groups thousands.
 */
export function CountUp({
  to,
  from = 0,
  seconds = 1.6,
  decimals = 0,
  prefix = "",
  suffix = "",
  format,
  className,
}: {
  to: number;
  from?: number;
  seconds?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (value: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [value, setValue] = useState(from);
  const shown = useRef(from);
  useEffect(() => {
    if (!inView) return;
    if (prefersReducedMotion() || seconds <= 0) {
      shown.current = to;
      setValue(to);
      return;
    }
    // From wherever it stands now, so a number that updates later glides instead of restarting.
    const start = shown.current;
    let raf = 0;
    let began = 0;
    const tick = (now: number) => {
      began ||= now;
      const t = Math.min((now - began) / (seconds * 1000), 1);
      const eased = 1 - Math.pow(1 - t, 4);
      shown.current = start + (to - start) * eased;
      setValue(shown.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, seconds]);
  const still = useFxOff();
  const final = format ? format(to) : to.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  // In a picture of the page the number is the real one, not wherever the count had got to.
  const text = still ? final : format ? format(value) : value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }} aria-label={prefix + final + suffix}>
      <span aria-hidden="true">
        {prefix}
        {text}
        {suffix}
      </span>
    </span>
  );
}
`;

const SURFACES = `import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import "./fx.css";
import { prefersReducedMotion } from "./Reveal";

/**
 * A card with a soft light that follows the pointer. Put the card's own classes in className
 * (rounded-2xl border border-border bg-card p-6). glow is a CSS colour; it defaults to a faint accent.
 */
export function SpotlightCard({
  children,
  className,
  glow = "color-mix(in srgb, var(--color-accent, #7c3aed) 22%, transparent)",
  size = 320,
}: {
  children: ReactNode;
  className?: string;
  glow?: string;
  size?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    el.style.setProperty("--fx-x", e.clientX - box.left + "px");
    el.style.setProperty("--fx-y", e.clientY - box.top + "px");
  };
  const style = { "--fx-glow": glow, "--fx-size": size + "px" } as CSSProperties;
  return (
    <div ref={ref} onPointerMove={move} className={"fx-spotlight" + (className ? " " + className : "")} style={style}>
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

/**
 * A card that leans toward the pointer. For one or two showcase pieces (a product shot, an NFT, a
 * membership card), not a whole grid. It stays flat on touch screens. max is the lean in degrees.
 */
export function TiltCard({ children, className, max = 8 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || prefersReducedMotion()) return;
    const box = el.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;
    el.style.setProperty("--fx-ry", x * 2 * max + "deg");
    el.style.setProperty("--fx-rx", -y * 2 * max + "deg");
  };
  const rest = () => {
    ref.current?.style.setProperty("--fx-ry", "0deg");
    ref.current?.style.setProperty("--fx-rx", "0deg");
  };
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={rest} className={"fx-tilt" + (className ? " " + className : "")}>
      {children}
    </div>
  );
}

/**
 * Pulls what is inside it a little toward the pointer: wrap the page's ONE main button in it.
 * strength is how far it follows, from 0 to 1.
 */
export function Magnetic({ children, strength = 0.3, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || prefersReducedMotion()) return;
    const box = el.getBoundingClientRect();
    el.style.setProperty("--fx-mx", (e.clientX - (box.left + box.width / 2)) * strength + "px");
    el.style.setProperty("--fx-my", (e.clientY - (box.top + box.height / 2)) * strength + "px");
  };
  const rest = () => {
    ref.current?.style.setProperty("--fx-mx", "0px");
    ref.current?.style.setProperty("--fx-my", "0px");
  };
  return (
    <span ref={ref} onPointerMove={move} onPointerLeave={rest} className={"fx-magnetic" + (className ? " " + className : "")}>
      {children}
    </span>
  );
}

/**
 * A row that scrolls sideways for ever: names, features, tags, or the user's own uploaded logos.
 * Never invent partner or customer logos to fill it. seconds is one full pass; hover pauses it.
 */
export function Marquee({
  children,
  seconds = 30,
  reverse = false,
  pauseOnHover = true,
  gap = "3rem",
  className,
}: {
  children: ReactNode;
  seconds?: number;
  reverse?: boolean;
  pauseOnHover?: boolean;
  gap?: string;
  className?: string;
}) {
  const style = { "--fx-dur": seconds + "s", "--fx-gap": gap } as CSSProperties;
  return (
    <div className={"fx-marquee" + (className ? " " + className : "")} data-reverse={reverse} data-pause={pauseOnHover} style={style}>
      <div className="fx-marquee-track">{children}</div>
      {/* The second copy makes the loop seamless; screen readers hear the row once. */}
      <div className="fx-marquee-track" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
`;

const BACKGROUNDS = `import type { CSSProperties } from "react";
import "./fx.css";

/**
 * Soft blurred colour that drifts slowly behind a hero or a call-to-action band. Put it first inside
 * a section that has "relative overflow-hidden", and give the content after it "relative". colors are
 * up to three CSS colours; they default to the theme's accent and a softer tint of it (a near-black
 * primary would only make a grey smudge). strength is its opacity.
 */
export function Aurora({
  colors = ["var(--color-accent, #7c3aed)", "color-mix(in srgb, var(--color-accent, #7c3aed) 45%, var(--color-background, #ffffff))", "var(--color-accent, #7c3aed)"],
  strength = 0.3,
  seconds = 18,
  className,
}: {
  colors?: string[];
  strength?: number;
  seconds?: number;
  className?: string;
}) {
  const style = { "--fx-a": colors[0], "--fx-b": colors[1] ?? colors[0], "--fx-c": colors[2] ?? colors[0], "--fx-strength": String(strength), "--fx-dur": seconds + "s" } as CSSProperties;
  return (
    <div aria-hidden="true" className={"fx-aurora" + (className ? " " + className : "")} style={style}>
      <span />
      <span />
      <span />
    </div>
  );
}

/**
 * A faint grid of dots or lines that fades out toward the edges, behind a hero. Same placing as
 * Aurora: first child of a "relative overflow-hidden" section. It does not move.
 */
export function GridPattern({
  variant = "dots",
  size = 28,
  color = "color-mix(in srgb, var(--color-foreground, #0f172a) 16%, transparent)",
  className,
}: {
  variant?: "dots" | "lines";
  size?: number;
  color?: string;
  className?: string;
}) {
  const image =
    variant === "dots"
      ? "radial-gradient(" + color + " 1px, transparent 1px)"
      : "linear-gradient(to right, " + color + " 1px, transparent 1px), linear-gradient(to bottom, " + color + " 1px, transparent 1px)";
  return <div aria-hidden="true" className={"fx-grid" + (className ? " " + className : "")} style={{ backgroundImage: image, backgroundSize: size + "px " + size + "px" }} />;
}
`;

const GUIDE = `Motion and effects. The kit's files are in src/fx/: use them, don't rewrite them, and don't hand-write keyframes, IntersectionObservers or animation packages (framer-motion, motion and gsap are not installed).
- Reveal.tsx: <Reveal from="up" delay={0.1}> fades its children in when they scroll onto the screen (from: up, down, left, right, scale, none; blur for a soft focus-in). <Stagger className="grid gap-4 sm:grid-cols-3"> reveals each child a moment after the last; it wraps every child, so the grid or flex classes go on Stagger itself. useInView() and prefersReducedMotion() are there for your own pieces.
- Text.tsx: <SplitText text="..." as="h1" className="..."> brings a headline in word by word (by="letter" for a short one). <GradientText> fills a few words with a moving gradient. <RotatingText words={[...]}> swaps one word of a sentence. <CountUp to={1280} prefix="G$ " /> counts a number up when it is seen.
- Surfaces.tsx: <SpotlightCard className="rounded-2xl border border-border bg-card p-6"> has a light that follows the pointer. <TiltCard> leans toward the pointer. <Magnetic> pulls the main button toward the pointer. <Marquee seconds={30}> scrolls a row sideways for ever.
- Backgrounds.tsx: <Aurora /> is slow drifting colour in the theme's accent (pass colors={[...]} for others, and never a near-black or grey: it reads as a smudge), <GridPattern variant="dots" /> a faint grid that fades at the edges. Both go FIRST inside a section with "relative overflow-hidden", and the content after them needs "relative" so it sits on top.

Motion is part of the design, not decoration on top of it. Choose it the way a designer would:
- One hero moment per page: SplitText on the headline, OR Aurora or GridPattern behind it, with the supporting line and the button in a <Reveal delay>. Not all of them at once.
- Below the fold, sections arrive with Reveal, and rows of cards or steps with Stagger. Use the same direction and timing down the whole page: consistency is what makes it feel designed.
- Numbers that matter (raised, members, votes) use CountUp, fed with the real value. While the value is loading show the Skeleton, then mount CountUp. Never count up to a number that is made up.
- Micro-interactions on what can be clicked: SpotlightCard for feature and pricing cards, Magnetic on the single main call to action, TiltCard for one showcase piece. A page where everything moves has no focus.
- Marquee is for content that exists: the app's own features or tags, or logos the user uploaded. Never invent partner, press or customer logos to fill one.
- Keep contrast. Text over Aurora must still read: keep strength at 0.2 to 0.4 on a light page and put body text on bg-background or bg-card. GradientText is for 2 to 4 words of a headline, never body text or a button label.
- Forms, wallet actions, tables and anything a person is in the middle of using stay still. Don't wrap inputs, the ConnectButton, Notices or a transaction's state in Reveal: a person must never wait for an animation to act, and a Notice that appears later must not replay.
- Phones first: these effects are cheap (transform and opacity only), but keep to one Aurora per screen and don't put a blur behind long scrolling lists.
- Reduced motion is handled inside the kit: everything appears in its final state. Don't add your own checks.
- Don't put a fixed duration or delay longer than 1 second on anything above the fold: the page must be usable at once.

A hero written this way:
    <section className="relative overflow-hidden px-4 py-20 sm:py-28">
      <Aurora strength={0.25} />
      <div className="relative mx-auto max-w-3xl text-center">
        <SplitText as="h1" text="Save together, reach it sooner" className="font-display text-4xl font-semibold tracking-tight sm:text-6xl" />
        <Reveal delay={0.35}><p className="mt-5 text-lg text-muted-foreground">One line that says who it is for and what they get.</p></Reveal>
        <Reveal delay={0.5}><div className="mt-8 flex justify-center"><Magnetic><Button size="lg">Start a circle</Button></Magnetic></div></Reveal>
      </div>
    </section>`;

export const motion: Kit = {
  id: "motion",
  title: "Motion and effects",
  when: "a landing page, marketing site, portfolio, or any page that should feel polished and alive: a headline that animates in, sections that reveal on scroll, numbers that count up, a scrolling row, cards with a spotlight or tilt, an aurora or grid behind the hero",
  keywords:
    /\b(landing pages?|home ?page|marketing (?:site|page|website)|portfolio|personal (?:site|website)|product page|launch page|waitlist page|animat(?:ed|ions?|e)|motion|scroll (?:reveal|effects?|animations?)|parallax|marquee|aurora|spotlight|glow(?:ing)?|react ?bits|lovable|stunning|sleek|premium|polished|eye[- ]catching|wow factor|interactive (?:site|page|website))\b/i,
  packages: {},
  files: {
    "src/fx/fx.css": FX_CSS,
    "src/fx/Reveal.tsx": REVEAL,
    "src/fx/Text.tsx": TEXT,
    "src/fx/Surfaces.tsx": SURFACES,
    "src/fx/Backgrounds.tsx": BACKGROUNDS,
  },
  guide: GUIDE,
  replaces: ["framer-motion", "motion", "gsap", "animejs", "react-spring", "@react-spring/web", "aos", "react-countup", "react-fast-marquee"],
};
