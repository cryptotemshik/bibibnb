import { useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN_ID } from "../config";
import { useSignerControls } from "../signer";

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

  const { mode, setMode, local, setLocalKey, clearLocal } = useSignerControls();
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  function loadKey() {
    try {
      setLocalKey(keyInput);
      setKeyInput("");
      setKeyError(null);
    } catch (e) {
      setKeyError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h1>
          LAUNCHPAD<span className="dim">@robinhood-chain</span>
          <span className="cursor">▌</span>
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="mode-toggle">
            <button
              className={mode === "wallet" ? "active" : ""}
              onClick={() => setMode("wallet")}
            >
              wallet
            </button>
            <button
              className={mode === "local" ? "active" : ""}
              onClick={() => setMode("local")}
            >
              fast ⚡
            </button>
          </div>

          {mode === "wallet" ? (
            !isConnected ? (
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
            )
          ) : local ? (
            <>
              <span className="pill warn">⚡ local · auto-sign</span>
              <span className="pill">{shortAddress(local.account.address)}</span>
              <button className="danger" onClick={clearLocal}>
                remove key
              </button>
            </>
          ) : (
            <span className="pill warn">no key loaded</span>
          )}
        </div>
      </div>

      {mode === "local" && !local ? (
        <div className="panel signer-panel">
          <h2>Fast mode — local signer</h2>
          <p className="warn" style={{ marginTop: 0 }}>
            ⚠ Paste ONE private key. Transactions then sign automatically with no
            wallet pop-up. The key stays in this tab&apos;s memory only — never
            saved, never sent anywhere — and is gone on refresh. Anyone who can
            run script in this page (a browser extension, a bad dependency, an
            XSS bug) can read it. For real funds, run LaunchPad locally
            (<span className="mono-break">git clone … &amp;&amp; npm run dev</span>)
            rather than on the public URL, and use a wallet that holds only what
            this session needs.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type={reveal ? "text" : "password"}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="0x… (64 hex chars)"
              autoComplete="off"
              spellCheck={false}
              style={{ flex: 1, minWidth: 240 }}
              onKeyDown={(e) => e.key === "Enter" && loadKey()}
            />
            <button className="secondary" onClick={() => setReveal(!reveal)}>
              {reveal ? "hide" : "show"}
            </button>
            <button className="primary" onClick={loadKey}>
              use key
            </button>
          </div>
          {keyError ? <p className="error">{keyError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
