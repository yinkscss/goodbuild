/** useWallet.ts exactly as GoodBuild wrote it before D163, for the upgrade test. */
export const OLD_USE_WALLET = String.raw`import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { connectWallet, disconnectWallet, restoreWallet, subscribeWallet, walletState } from "./goodbuild/wallet";

/**
 * The connected account, the wallet's name, connect and disconnect, and any connection error.
 * connect() shows the wallet list (browser wallets and, once published, phone wallets by QR code or
 * link); inside MiniPay it connects on its own. The last wallet used reconnects on the next visit.
 */
export function useWallet() {
  const state = useSyncExternalStore(subscribeWallet, walletState, walletState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void restoreWallet();
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      await connectWallet();
    } catch (e) {
      // Closing the list or rejecting in the wallet isn't an error worth showing.
      if ((e as { code?: unknown }).code !== 4001) setError(e instanceof Error ? e.message : "Could not connect.");
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    await disconnectWallet();
  }, []);

  return { account: state.account, walletName: state.wallet?.name ?? null, connect, disconnect, connecting: state.connecting, error };
}
`;
