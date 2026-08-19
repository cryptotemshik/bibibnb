import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import {
  createWalletClient,
  http,
  type Account,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { CHAIN_ID, robinhoodChain } from "./config";
import { normalizePrivateKey } from "./lib/convert";

export type SignerMode = "wallet" | "local";

interface LocalSigner {
  account: PrivateKeyAccount;
  walletClient: WalletClient;
}

interface SignerControls {
  mode: SignerMode;
  setMode: (m: SignerMode) => void;
  local: LocalSigner | null;
  /** Load a single private key into memory. Throws on an invalid key. */
  setLocalKey: (raw: string) => void;
  /** Wipe the in-memory key. */
  clearLocal: () => void;
}

const Ctx = createContext<SignerControls | null>(null);

export function SignerProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<SignerMode>("wallet");
  const [local, setLocal] = useState<LocalSigner | null>(null);

  function setLocalKey(raw: string) {
    const key = normalizePrivateKey(raw);
    const account = privateKeyToAccount(key);
    // http() with no url uses the chain's default RPC. This client signs
    // locally and broadcasts eth_sendRawTransaction — the key never leaves.
    const walletClient = createWalletClient({
      account,
      chain: robinhoodChain,
      transport: http(),
    });
    setLocal({ account, walletClient });
  }

  function clearLocal() {
    setLocal(null);
  }

  const value = useMemo(
    () => ({ mode, setMode, local, setLocalKey, clearLocal }),
    [mode, local],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSignerControls(): SignerControls {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSignerControls outside SignerProvider");
  return ctx;
}

export interface ActiveSigner {
  mode: SignerMode;
  /** Lowercase-comparable address for display/ownership checks. */
  address?: `0x${string}`;
  /** What to pass to viem calls as `account` (Account object in local mode). */
  txAccount?: Account | `0x${string}`;
  walletClient?: WalletClient;
  chainId?: number;
  isConnected: boolean;
  wrongNetwork: boolean;
}

/**
 * The one hook every tab uses to sign. Abstracts over the injected browser
 * wallet (wagmi) and the in-memory local signer, so nothing downstream needs
 * to know which is active.
 */
export function useSigner(): ActiveSigner {
  const ctx = useContext(Ctx);
  const { address: wAddr, isConnected: wConnected } = useAccount();
  const wChain = useChainId();
  const { data: wWallet } = useWalletClient();

  if (ctx?.mode === "local") {
    if (!ctx.local) {
      return { mode: "local", isConnected: false, wrongNetwork: false };
    }
    return {
      mode: "local",
      address: ctx.local.account.address,
      txAccount: ctx.local.account,
      walletClient: ctx.local.walletClient,
      chainId: CHAIN_ID,
      isConnected: true,
      wrongNetwork: false,
    };
  }
  return {
    mode: "wallet",
    address: wAddr,
    txAccount: wAddr,
    walletClient: wWallet ?? undefined,
    chainId: wChain,
    isConnected: wConnected,
    wrongNetwork: wConnected && wChain !== CHAIN_ID,
  };
}
