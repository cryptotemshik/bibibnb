import { useState } from "react";
import ConnectBar from "./components/ConnectBar";
import DashboardTab from "./components/DashboardTab";
import LaunchTab from "./components/LaunchTab";
import MintTab from "./components/MintTab";
import RevealTab from "./components/RevealTab";
import StatusTab from "./components/StatusTab";
import { EXPLORER_URL } from "./config";

type Tab = "dashboard" | "launch" | "reveal" | "status" | "mint";

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

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
        explorer:{" "}
        <a href={EXPLORER_URL} target="_blank" rel="noreferrer">
          {EXPLORER_URL.replace("https://", "")}
        </a>
      </div>
    </>
  );
}
