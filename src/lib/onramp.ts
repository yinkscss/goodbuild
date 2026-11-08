/**
 * Getting CELO (D53). The user buys CELO with a card or bank transfer on a provider's own page and
 * it lands in their wallet; GoodBuild never touches the card or the money. Transak is the provider
 * wired in (it lists CELO on Celo), and it stays off until NEXT_PUBLIC_TRANSAK_API_KEY is set. The
 * key is a public identifier, not a secret. Swapping provider means changing this one function.
 */
export function onrampUrl(wallet: string | null | undefined, env: { key?: string; staging?: boolean } = { key: process.env.NEXT_PUBLIC_TRANSAK_API_KEY, staging: process.env.NEXT_PUBLIC_TRANSAK_STAGING === "1" }): string | null {
  if (!env.key || !wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null;
  const params = new URLSearchParams({
    apiKey: env.key,
    cryptoCurrencyCode: "CELO",
    network: "celo",
    walletAddress: wallet,
    disableWalletAddressForm: "true",
    themeColor: "6d4aff",
  });
  return `https://global${env.staging ? "-stg" : ""}.transak.com/?${params.toString()}`;
}
