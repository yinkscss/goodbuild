/** Auth failures with a stable code the client can switch on, and the HTTP status to use. */
export type AuthErrorCode =
  | "unauthenticated"
  | "nonce_missing"
  | "nonce_mismatch"
  | "message_invalid"
  | "domain_mismatch"
  | "chain_unsupported"
  | "message_expired"
  | "signature_invalid"
  | "attestation_required"
  | "region_blocked"
  | "magic_invalid"
  | "magic_unconfigured";

const STATUS: Record<AuthErrorCode, number> = {
  unauthenticated: 401,
  nonce_missing: 400,
  nonce_mismatch: 400,
  message_invalid: 400,
  domain_mismatch: 400,
  chain_unsupported: 400,
  message_expired: 400,
  signature_invalid: 401,
  attestation_required: 403,
  region_blocked: 451,
  magic_invalid: 401,
  magic_unconfigured: 503,
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
    this.status = STATUS[code];
  }
}
