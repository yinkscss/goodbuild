/** Each verified person (one GoodDollar identity, however many wallets) has this many approvals in total (D155). */
export const MAX_APPROVALS_PER_PERSON = 3;

export interface VoteStatus {
  max: number;
  used: number;
  /** One entry ID per approval unit; an ID can appear more than once. */
  entryIds: string[];
  signedIn: boolean;
  verified: boolean;
  /** A confirmed on-chain FlowState vote for GoodBuild. */
  voted: boolean;
  /** Celo couldn't be read, so `verified: false` means "unknown", not "not verified". */
  checkFailed?: boolean;
}
