/**
 * Provider-agnostic auth contract. UI code only talks to this (via useAuth / useWallet);
 * the Privy implementation lives in ./privy, so a thirdweb fallback (P5) touches one folder.
 */

export type WalletKind = "embedded" | "external";

/** The external wallets offered in the connect modal (mockup a). */
export type ExternalWalletId = "metamask" | "minipay" | "walletconnect" | "coinbase";

export interface Attestation {
  ageOk: boolean;
  notUsPerson: boolean;
}

export interface SessionUser {
  id: string;
  wallet: string;
  walletKind: WalletKind;
  verified: boolean;
}

export interface WalletState {
  address: `0x${string}`;
  /** Numeric chain id, or null if the wallet didn't report one. */
  chainId: number | null;
  kind: WalletKind;
  /** e.g. "MetaMask", "Email wallet". */
  label: string;
}

export type AuthPhase =
  | "idle"
  | "sending-code"
  | "awaiting-code"
  | "verifying-code"
  | "connecting"
  | "signing"
  | "error";

export interface AuthApi {
  /** False when no auth provider is configured (no Privy app id). */
  configured: boolean;
  /** True once the provider and the server session check have settled. */
  ready: boolean;
  /** The server session user. Signed in means this is non-null. */
  user: SessionUser | null;
  /** The wallet currently connected in the browser (may exist without a session). */
  wallet: WalletState | null;
  phase: AuthPhase;
  error: string | null;
  /** Which external wallets appear to be installed (for the "Detected" chip). */
  detected: Partial<Record<ExternalWalletId, boolean>>;

  sendEmailCode(email: string): Promise<void>;
  /** Verifies the OTP; once the embedded wallet exists, signs in with SIWE. */
  verifyEmailCode(code: string, attestation: Attestation): Promise<void>;
  /** Connects an external wallet, then signs in with SIWE. */
  connectWallet(id: ExternalWalletId, attestation: Attestation): Promise<void>;
  /** Sign in with the already-connected wallet. */
  signInWithConnectedWallet(attestation: Attestation): Promise<void>;
  /** Back to the start of the modal (clears errors and OTP state). */
  reset(): void;
  signOut(): Promise<void>;
  switchChain(chainId: number): Promise<void>;
  /** Only for embedded wallets. */
  exportKey?: () => Promise<void>;
}
