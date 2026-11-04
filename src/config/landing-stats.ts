/**
 * Landing metric card data.
 *
 * SAMPLE DATA. These are the mockup's numbers, not real activity. GoodBuild has no
 * deploys yet, so showing them as "Live" would be false (DESIGN_SYSTEM §7 asks for
 * real numbers). `isLive` stays false until this is fed from the deployments table
 * (see OPEN_QUESTIONS.md Q24). When false, the card shows a "Preview" chip.
 */
export interface LandingStats {
  isLive: boolean;
  headlineLabel: string;
  headlineValue: string;
  deltaLabel: string;
  /** Seven daily values, Monday to Sunday. Only the shape is drawn. */
  series: number[];
  footerLabel: string;
  footerValue: string;
}

export const landingStats: LandingStats = {
  isLive: false,
  headlineLabel: "G$ deployed this week",
  headlineValue: "2.48M",
  deltaLabel: "+31.6% vs last week",
  series: [12, 30, 26, 46, 42, 70, 84],
  footerLabel: "Contracts compiled",
  footerValue: "14,902",
};

/** Sample balance shown in the logged-out prompt box hint, as in the mockup. */
export const SAMPLE_CREDITS_LABEL = "120 G$";
