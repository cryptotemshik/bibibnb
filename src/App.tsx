import { useState } from "react";
import ConnectBar from "./components/ConnectBar";
import DashboardTab from "./components/DashboardTab";
import LaunchTab from "./components/LaunchTab";
import MintTab from "./components/MintTab";
import RevealTab from "./components/RevealTab";
import StatusTab from "./components/StatusTab";
import { EXPLORER_URL, SEADROP_ADDRESS, explorerAddressUrl } from "./config";

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
        SeaDrop:{" "}
        <a href={explorerAddressUrl(SEADROP_ADDRESS)} target="_blank" rel="noreferrer">
          {SEADROP_ADDRESS}
        </a>{" "}
        · explorer:{" "}
        <a href={EXPLORER_URL} target="_blank" rel="noreferrer">
          {EXPLORER_URL.replace("https://", "")}
        </a>
        <br />
        Creator tool for launching YOUR collections from YOUR wallet. Single
        wallet only — no multi-account, no minting bots, no auto-listing.
        Signing is either your browser wallet or, in fast mode, one private key
        held in this tab&apos;s memory (never saved, never sent anywhere).
      </div>
    </>
  );
}
