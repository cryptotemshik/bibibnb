import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN_ID } from "../config";

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function ConnectBar() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongNetwork = isConnected && chainId !== CHAIN_ID;

  return (
    <div className="topbar">
      <h1>
        LAUNCHPAD<span className="dim">@robinhood-chain</span>
        <span className="cursor">▌</span>
      </h1>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {!isConnected ? (
          <>
            <button
              className="secondary"
              disabled={isPending}
              onClick={() => connect({ connector: connectors[0] })}
            >
              {isPending ? "connecting…" : "connect wallet"}
            </button>
            {error ? <span className="error">{error.message}</span> : null}
          </>
        ) : (
          <>
            {wrongNetwork ? (
              <button
                className="danger"
                disabled={switching}
                onClick={() => switchChain({ chainId: CHAIN_ID })}
              >
                {switching ? "switching…" : "wrong network — switch to Robinhood Chain"}
              </button>
            ) : (
              <span className="pill ok">robinhood-chain:4663</span>
            )}
            <span className="pill">{shortAddress(address!)}</span>
            <button className="secondary" onClick={() => disconnect()}>
              disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}
