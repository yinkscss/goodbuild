/** Pure helpers for the logged-in home (design/app/b-home.html). */

export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** "Just now", "12 min ago", "2h ago", "Yesterday", "3 days ago", "Last week", "4 Nov". */
export function relativeTime(then: Date, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.ceil((startOfToday.getTime() - then.getTime()) / 86_400_000);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export type StatusTone = "success" | "pink" | "warning" | "violet" | "grey";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

const NETWORK: Record<number, string> = { 11142220: "Celo Sepolia", 42220: "Celo" };

/** Project status line and dot colour for cards and the sidebar. */
export function projectStatusMeta(status: string, chainId: number): StatusMeta {
  const network = NETWORK[chainId] ?? "Celo";
  switch (status) {
    case "deployed":
      return { label: `Deployed · ${network}`, tone: "success" };
    case "building":
      return { label: "Building…", tone: "violet" };
    case "needs_fix":
      return { label: "Needs fix · build error", tone: "warning" };
    case "ready":
      return { label: `Ready to deploy · ${network}`, tone: "violet" };
    case "draft":
    default:
      return { label: "Draft", tone: "pink" };
  }
}

export const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-success",
  pink: "bg-pink",
  warning: "bg-warning",
  violet: "bg-violet",
  grey: "bg-grey-400",
};

/** DESIGN_SYSTEM §3 credits pill: warning at ≤10 G$, Send disabled at 0. */
export const LOW_CREDIT_THRESHOLD_GD = 10;

export type CreditState = "preview" | "ok" | "low" | "empty";

/** `null` balance means the credit ledger isn't live yet (before credits are live). */
export function creditState(balanceGd: number | null): CreditState {
  if (balanceGd === null) return "preview";
  if (balanceGd <= 0) return "empty";
  if (balanceGd <= LOW_CREDIT_THRESHOLD_GD) return "low";
  return "ok";
}

/** "120 G$", "1.2K G$", "2.48M G$". */
export function formatGd(amount: number): string {
  const abs = Math.abs(amount);
  const fmt = (n: number, suffix: string) => `${Number(n.toFixed(n < 10 ? 2 : 1))}${suffix} G$`;
  if (abs >= 1_000_000) return fmt(amount / 1_000_000, "M");
  if (abs >= 10_000) return fmt(amount / 1_000, "K");
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} G$`;
}
