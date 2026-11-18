# FlowState voting with the existing Magic wallet

GoodBuild users can vote for GoodBuildIt without connecting a second wallet or exporting a key. GoodBuild signs through its existing `AuthApi.getWalletClient()` adapter, which works with the Magic email wallet and external wallets. This integrates the voting protocol directly; it does not copy GoodBuild's login into FlowState or embed their whole website.

## Verified integration targets (18 Nov 2026)

- Celo mainnet, chain 42220.
- GoodBuilders S5 council: `0x889e0aadaa3f8b28a794ef70da147827c620a590`.
- GoodBuildIt, accepted application/project 189, funding recipient: `0xf0449277e30cc9063147bfb9ecdf036bf9d41531`.
- Deployed contract: verified `FlowCouncil`, no proxy implementation. Runtime hash pinned to `0x4f4b3bed84f524cc5162457e1ed5233b5527807945185a94a40a640bebf2c591`. A mismatch fails closed before any signing request.
- The public Community voter group uses GoodDollar identity and currently grants 10 voting points. The app always reads actual on-chain power rather than hardcoding 10.
- `vote((address recipient,uint96 amount)[])` updates only the supplied recipients' absolute allocations. Submitting only GoodBuildIt's increased allocation preserves every other project's votes. Available power and spread limits are read and enforced before simulation.

Primary sources:

- [FlowState writeBallot](https://github.com/flow-state-coop/platform/blob/3f7adc268794d9b06ddb2c54eb276520c2e83ee0/src/app/flow-councils/hooks/writeBallot.ts)
- [FlowState eligibility endpoint](https://github.com/flow-state-coop/platform/blob/3f7adc268794d9b06ddb2c54eb276520c2e83ee0/src/app/api/flow-council/eligibility/route.ts)
- [FlowState claim format](https://github.com/flow-state-coop/platform/blob/3f7adc268794d9b06ddb2c54eb276520c2e83ee0/src/app/flow-councils/lib/claimMessage.ts)
- [Verified deployed contract](https://celo.blockscout.com/api/v2/smart-contracts/0x889e0aadaa3f8b28a794ef70da147827c620a590)
- [Accepted projects](https://flowstate.network/api/flow-council/applications/public?chainId=42220&councilId=0x889e0aadaa3f8b28a794ef70da147827c620a590)
- [Public voter groups](https://flowstate.network/api/flow-council/voter-groups/public?chainId=42220&councilId=0x889e0aadaa3f8b28a794ef70da147827c620a590&includeMembers=0)
- [Magic transaction signing](https://docs.magic.link/embedded-wallets/wallets/features/transaction-signing)
- [Magic sign confirmation](https://docs.magic.link/embedded-wallets/wallets/security/sign-confirmation)

## User flow

1. Click **Vote here with your email wallet**. The app checks the council, recipient, GoodDollar identity, voting rights and existing ballot; it requests no signature just to open the dialog.
2. If necessary, click **Enable voting with this wallet**. A human-readable signature authorizes FlowState to register this exact wallet in this council. The fixed claim message includes council, chain, wallet and a short-lived timestamp. It is not a login, token approval or payment. FlowState's own eligibility service registers the voter.
3. The visual slider selects all available points by default (normally 10); users can drag to adjust before confirming. The app supports only increases from unallocated power; it never silently takes votes away from another project. Existing supporters can confirm their current positive allocation without another transaction. An already allocated ballot is never silently reallocated.
4. Review the project, allocation change, zero G$ transferred, and CELO network fee cap. The server simulates the exact call and checks the wallet's gas balance. It uses a gas limit with 20% headroom and explicit fee caps.
5. Click **Confirm vote for GoodBuildIt**. The client checks the signer, switches to Celo, rechecks the ballot and fee, and requests exactly the pinned contract call. If the ballot changed or the fee increased, another review is required.
6. The backend validates sender, target, zero native transfer value, decoded single-recipient calldata, successful receipt, three Celo confirmations and the resulting on-chain allocation. It saves `voted`, a transaction hash and confirmation time. Opening the external link still records only `visited`.

Pending hashes are kept locally by wallet, without keys or login tokens. Reopening can resume confirmation. Definite reverts clear the pending check; recovery also lets the user stop tracking a replaced/dropped transaction after an explicit explanation that tracking does not cancel it. No recovery action automatically resubmits.

The FlowState step is now required for the initial free-credit grant. The signup flow and popup keep users on GoodBuild and have no skip or official-site navigation. The credits API requires recorded confirmation and independently rechecks settled, verified positive support on-chain before granting initial credits. Later deploy credits retain the entitlement earned at registration.

## Backend boundaries

`/api/hackathon/flowstate` requires a GoodBuild session and inherits the existing same-origin write guard. The server accepts no caller-selected RPC, council, recipient, URL, arbitrary transaction or arbitrary signing message. The eligibility proxy independently verifies the signature against the session wallet, enforces the five-minute timestamp window, and forwards only the signed council claim to the fixed FlowState endpoint. No cookies, Magic DID tokens, session tokens, keys or email addresses are sent to FlowState.

A conditional database update allows one eligibility claim per account every 90 seconds, longer than the 60-second upstream timeout. Existing registered voters bypass the upstream claim. The original FlowState service enforces one voter wallet per GoodDollar identity.

Migration `0023_flowstate_vote_proof` adds the claim timestamp and confirmation evidence. Apply migrations before deployment. The CSV includes the last confirmed transaction hash, confirmation time and progress state. Legacy link-visit/skip metadata is never accepted as proof and cannot erase a recorded confirmation. An existing-ballot check records current on-chain support without inventing a transaction hash; an earlier recorded hash is retained.

## Gas and remaining live checks

No new wallet SDK, WalletConnect relay or iframe bridge is needed. Magic's hosted sign confirmation can additionally be enabled in its dashboard; GoodBuild always supplies its own review before requesting the transaction.

The vote requires a small CELO network fee in the user's wallet. Setup registration is handled by FlowState's service, but this implementation does not pretend that the user's vote transaction is sponsored. The dialog shows the fee and provides the receiving wallet address if gas is missing. A fully sponsored experience requires separately funded infrastructure/provider configuration. Magic's smart-account sponsorship requires additional provider setup, and Celo support must be verified before choosing it; Celo fee abstraction is not assumed to work with Magic.

Verified here: public metadata, deployed code hash, recipient and voter reads, successful live `eth_call` simulation and gas estimate of the exact vote method, automated backend/UI tests, browser layout and review. The live simulation did not sign or broadcast anything. A real Magic email-wallet vote still requires a funded user wallet and deliberate human confirmation; no real vote was cast by the coding agent.

Targeted check:

```sh
pnpm test -- src/lib/flowstate src/server/flowstate src/app/api/hackathon/flowstate/route.test.ts src/components/hackathon src/server/hackathon
```
