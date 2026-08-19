import { useState } from "react";
import ConnectBar from "./components/ConnectBar";
import DashboardTab from "./components/DashboardTab";
import LaunchTab from "./components/LaunchTab";
import MintTab from "./components/MintTab";
import RevealTab from "./components/RevealTab";
import StatusTab from "./components/StatusTab";
import { useActiveChain } from "./signer";
import { CHAINS_BY_ID, DEFAULT_CHAIN_ID } from "./chains";

type Tab = "dashboard" | "launch" | "reveal" | "status" | "mint";

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const info = useActiveChain() ?? CHAINS_BY_ID.get(DEFAULT_CHAIN_ID)!;

  return (
    <>
      <ConnectBar />
      <div className="tabs">
        {(["launch", "reveal", "status", "dashboard"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t.toUpperCase()}
          </button>
        ))}
        <button
          className={`tab-mint ${tab === "mint" ? "active" : ""}`}
          onClick={() => setTab("mint")}
        >
          MINT
        </button>
      </div>
      {tab === "dashboard" ? <DashboardTab /> : null}
      {tab === "launch" ? <LaunchTab /> : null}
      {tab === "reveal" ? <RevealTab /> : null}
      {tab === "status" ? <StatusTab /> : null}
      {tab === "mint" ? <MintTab /> : null}
      <div className="footer">
        {info.label} · explorer:{" "}
        <a href={info.explorerUrl} target="_blank" rel="noreferrer">
          {info.explorerUrl.replace("https://", "")}
        </a>
      </div>
    </>
  );
}
