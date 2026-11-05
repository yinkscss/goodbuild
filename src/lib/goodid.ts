import { compressToEncodedURIComponent } from "lz-string";
import { getAddress, type Address } from "viem";

/**
 * Building GoodDollar's face verification link. This is what @goodsdks/citizen-sdk 1.2.7's
 * generateFVLink does. The SDK itself isn't used because it requires wagmi and installs a bundler as
 * a runtime dependency. The message must stay word for word: GoodDollar derives the identifier from it.
 */
const FV_MESSAGE = `Sign this message to request verifying your account <account> and to create your own secret unique identifier for your anonymized record.
You can use this identifier in the future to delete this anonymized record.
WARNING: do not sign this message unless you trust the website/application requesting this signature.`;

const FV_URL = "https://goodid.gooddollar.org";
const CELO_CHAIN_ID = 42220;

export const LINK_WALLET_GUIDE = "https://docs.gooddollar.org/user-guides/connect-another-wallet-address-to-identity";

export function faceVerificationMessage(account: Address): string {
  return FV_MESSAGE.replace("<account>", getAddress(account));
}

/** The result GoodDollar adds to `returnTo` is only a hint: the Identity contract decides. */
export function faceVerificationLink(account: Address, signature: string, returnTo: string, now = Date.now()): string {
  const params = { account: getAddress(account), nonce: Math.floor(now / 1000).toString(), fvsig: signature, chain: CELO_CHAIN_ID, rdu: returnTo };
  const url = new URL(FV_URL);
  url.searchParams.append("lz", compressToEncodedURIComponent(JSON.stringify(params)));
  return url.toString();
}
