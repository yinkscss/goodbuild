/**
 * The real src/lib/goodbuild/walletConnect.tsx, swapped in when an app is published with a
 * WalletConnect project id (D36). Same exports as the stand-in in src/server/agent/wallet-template.ts.
 * The app only reaches it through import(), so it ships as a separate chunk that loads when a
 * visitor picks WalletConnect (or comes back to a WalletConnect session).
 *
 * showQrModal is off: the app's own wallet list draws the QR code (qrcode.react) and the phone
 * wallet links, so Reown AppKit (its modal) is never bundled and the page's CSP needs no outside
 * images, fonts or scripts. WalletConnect itself needs the relay (wss:), its RPC and pulse endpoints
 * (https:) and the Verify iframe (frame-src https://verify.walletconnect.org), see service.ts.
 *
 * String.raw: no backticks or "${" inside.
 */
export const WALLETCONNECT_MODULE = String.raw`import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { QRCodeSVG } from "qrcode.react";
import type { Chain, EIP1193Provider } from "viem";

type WcProvider = Awaited<ReturnType<typeof EthereumProvider.init>>;

export const walletConnectBuiltIn = true;

let instance: Promise<WcProvider> | null = null;
/** The attempt the visitor is still looking at. A wallet that approves an older link is turned away. */
let latest = 0;

/** Methods that need the visitor to look at their wallet. */
const PROMPTS = new Set(["eth_sendTransaction", "personal_sign", "eth_sign", "eth_signTypedData", "eth_signTypedData_v4", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_watchAsset"]);

function isPhone(): boolean {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** On a phone, bring the wallet app forward for each request it must approve (UNVERIFIED on real phones). */
function openWalletForRequests(provider: WcProvider) {
  if (!isPhone()) return;
  const request = provider.request.bind(provider) as (args: { method: string; params?: unknown }) => Promise<unknown>;
  (provider as unknown as { request: typeof request }).request = (args) => {
    const result = request(args);
    if (PROMPTS.has(args.method)) {
      const redirect = provider.session?.peer?.metadata?.redirect;
      const link = redirect?.native || redirect?.universal;
      if (link) setTimeout(() => window.location.assign(link), 100);
    }
    return result;
  };
}

function init(projectId: string, chain: Chain): Promise<WcProvider> {
  if (!instance) {
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
    instance = EthereumProvider.init({
      projectId,
      showQrModal: false,
      optionalChains: [chain.id],
      rpcMap: { [chain.id]: chain.rpcUrls.default.http[0] },
      metadata: {
        name: document.title || "App",
        description: "Built with GoodBuild",
        url: window.location.origin,
        icons: icon ? [icon] : [],
      },
    }).then((provider) => {
      openWalletForRequests(provider);
      return provider;
    });
    instance.catch(() => {
      instance = null;
    });
  }
  return instance;
}

export async function connectWalletConnect(args: { projectId: string; chain: Chain; onUri: (uri: string) => void }): Promise<EIP1193Provider> {
  const attempt = ++latest;
  const closed = () => Object.assign(new Error("You closed the wallet list."), { code: 4001 });
  const provider = await init(args.projectId, args.chain);
  if (attempt !== latest) throw closed();
  const onUri = (uri: string) => {
    if (attempt === latest) args.onUri(uri);
  };
  provider.on("display_uri", onUri);
  try {
    await provider.connect({ optionalChains: [args.chain.id], rpcMap: { [args.chain.id]: args.chain.rpcUrls.default.http[0] } });
  } finally {
    provider.removeListener("display_uri", onUri);
  }
  if (attempt !== latest) {
    await provider.disconnect().catch(() => {});
    throw closed();
  }
  return provider as unknown as EIP1193Provider;
}

/** The WalletConnect session from an earlier visit, if the wallet still has it. */
export async function restoreWalletConnect(args: { projectId: string; chain: Chain }): Promise<EIP1193Provider | null> {
  const provider = await init(args.projectId, args.chain);
  return provider.session && provider.accounts.length ? (provider as unknown as EIP1193Provider) : null;
}

/** WalletConnect 2.26 can't abort a pairing (abortPairingAttempt is a no-op), so the old link just stops counting. */
export function cancelWalletConnect(): void {
  latest++;
}

export function QrCode({ value }: { value: string }) {
  return <QRCodeSVG value={value} size={240} marginSize={2} level="M" title="WalletConnect QR code" />;
}
`;
