# Auth and wallets (Stage 1)

**Status: proposed (P5).** Researched on 4 Nov 2026. Pricing and features change often, so re-check the linked pages before you sign up.

## Requirement (user)
- No prompt can be sent without a connected wallet and a signed-in session.
- Users can sign in with **email**, which creates an embedded wallet for them, or with an **external wallet** (MetaMask, MiniPay/Valora, WalletConnect, Coinbase).

## Options compared
| | Privy | thirdweb in-app wallets | MetaMask Embedded (ex-Web3Auth) | Reown AppKit | Dynamic |
|---|---|---|---|---|---|
| Celo mainnet (42220) and Celo Sepolia (11142220) | Any EVM chain via viem `celo` / `celoSepolia` or `defineChain` ([docs](https://docs.privy.io/basics/react/advanced/configuring-evm-networks)) | Yes, "2,500+ chains" ([pricing](https://thirdweb.com/pricing)) | Yes, docs list Celo mainnet and Sepolia ([docs](https://docs.metamask.io/embedded-wallets/connect-blockchain/evm/celo/)) | Login works on any viem chain, but embedded wallets **only transact on Blockchain-API chains** ([docs](https://docs.reown.com/appkit/authentication/socials)). Celo Sepolia is UNVERIFIED | Yes (EVM) |
| Email → embedded wallet | Yes | Yes (`preAuthenticate` email OTP) ([docs](https://portal.thirdweb.com/references/typescript/latest/inAppWallet)) | Yes | Yes | Yes |
| External wallets | MetaMask, Coinbase, WalletConnect (MiniPay/Valora via injected or WC) | 500+ via WalletConnect | Yes | 500+ (it *is* WalletConnect) | Yes |
| SIWE | Built in (`useLoginWithSiwe`) ([docs](https://docs.privy.io/authentication/user-authentication/login-methods/wallet)) | Built in (Auth / SIWE) | Via your own SIWE | SIWX built in | Built in |
| Free tier | 0–499 MAU free, then **$299/mo** at 500–2,499 ([pricing](https://www.privy.io/pricing)) | 1,000 MAU free, then $0.015/MAU (plan from $99/mo for some features) | 1,000 MAW free, $69/mo for 3k | 500 MAU free (hard cut-off), Pro $89/mo for 7.5k ([pricing](https://reown.com/pricing)) | Sandbox only, live from $249/mo ([pricing](https://www.dynamic.xyz/pricing)) |
| React/Next SDK | Excellent; wagmi adapter, polished modal, headless hooks | Good; own SDK (less wagmi-native) | OK | Good; wagmi-native | Good |
| Key export | Yes, `useExportWallet`, assembled on an isolated origin ([docs](https://docs.privy.io/wallets/wallets/export)) | Yes | Yes | Limited | Yes |

**GoodDollar's own stack:** GoodWallet V2 uses Web3Auth/Torus social logins plus Auth0 passwordless, with Reown WalletKit for WalletConnect ([repo](https://github.com/GoodDollar/GoodWallet), [docs](https://docs.gooddollar.org/wallet-and-dapps/new-goodwallet)). Even using the same provider would not give GoodBuild the user's GoodWallet address, because embedded addresses are scoped per app. GoodWallet users should connect it as an **external wallet** via WalletConnect.

## Recommendation
- **Primary: Privy** (`@privy-io/react-auth` + `@privy-io/wagmi`). It has the best React/Next developer experience, works with any EVM chain (Celo and Celo Sepolia), SIWE is built in, users can self-export keys, and Privy never holds a full key (TEE / split keys).
  - Risk: the free tier stops at 499 MAU, then it costs $299/mo.
- **Fallback: thirdweb in-app wallets.** It is cheaper at scale (1,000 free, $0.015/MAU) and supports Celo. Switch if Privy's price jump hurts before revenue.
- Keep wallet logic behind a thin `useAuth()` / `useWallet()` adapter over wagmi so we can switch providers without touching UI.
- Before M2, confirm Celo Sepolia works end-to-end in the Privy dashboard and that MiniPay's injected provider is detected.

## Flow
1. **Landing (logged out).** The prompt box is fully usable and typing is allowed.
2. **Prompt gating.** Pressing **Send** (or Cmd/Ctrl+Enter) while logged out:
   - saves the prompt to `sessionStorage` (`gb:pendingPrompt`);
   - opens the **Connect modal** over the page, with the typed prompt still visible behind it;
   - offers "Continue with email" (OTP) or a wallet list: MetaMask, MiniPay/Valora, WalletConnect, Coinbase.
3. **Connect.**
   - Email: enter the OTP, then Privy creates an embedded wallet.
   - Wallet: connect it.
4. **SIWE session.** The server issues a nonce, the user signs an EIP-4361 message (chain 42220 or 11142220), and the server verifies it and sets an httpOnly session cookie (7 days, rotating).
   - Embedded wallets sign silently.
   - The DB user is keyed by wallet address. Email is stored only if the user logged in with email.
5. **Workspace.** After a successful sign-in, restore the pending prompt, create a project and send the prompt automatically, then route to `/p/[id]`. The user never retypes.
6. **Network.**
   - Default is Celo Sepolia during Stage 1 testing, with mainnet behind a flag.
   - On the wrong chain, show a warning pill "Switch to Celo" that calls `wallet_switchEthereumChain` (or add-chain if missing).
   - Deploys are blocked until the user is on the right chain.
7. **Account menu** (avatar plus truncated address `0x7a3…e41c`):
   - copy address, view on Celoscan, network switch, credits and top-up, export key (embedded wallets only), disconnect.
8. **Credits pill** (top bar): G$ balance plus a USD estimate (`120 G$ · ≈$0.02`). It turns warning-coloured at ≤10 G$, and at 0 Send is disabled with "Top up to keep building" (see [CREDITS.md](CREDITS.md)).

## Rules
- The server authorises every agent call with the SIWE session, never with the client address alone.
- Never hold private keys. Every deploy is signed in the user's wallet.
- 18+ and non-US attestation checkbox on first sign-in (D10).

## Implementation (M2)
- Adapter: UI uses `useAuth()` / `useWallet()` from `src/lib/auth/context.tsx`. Privy lives only in `src/lib/auth/privy/` (P9).
- API: `GET /api/auth/nonce`, `POST /api/auth/verify`, `GET /api/auth/session`, `POST /api/auth/logout`. Nonces are single use, bound to a 5-minute signed cookie. The SIWE domain must equal `APP_DOMAIN` in production.
- Gating: `src/components/auth/send-gate.tsx` saves `gb:pendingPrompt`, opens the modal, and after sign-in creates the project and routes to `/p/[id]`.
- Check it end to end against a running server: `pnpm smoke:auth` (signs with a throwaway key).
- Design preview without Privy (development only): `/dev/preview?state=modal|code|connecting|error|connected|wrong-network`.
