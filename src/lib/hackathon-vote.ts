/** Each verified person (one GoodDollar identity, however many wallets) has this many approvals in total (D132). */
export const MAX_APPROVALS_PER_PERSON = 3;

export interface VoteStatus {
  max: number;
  used: number;
  /** Entries this person has approved. */
  entryIds: string[];
  signedIn: boolean;
  verified: boolean;
  /** A confirmed on-chain FlowState vote for GoodBuild. */
  voted: boolean;
}
