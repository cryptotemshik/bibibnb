import { useState } from "react";
import ConnectBar from "./components/ConnectBar";
import LaunchTab from "./components/LaunchTab";
import RevealTab from "./components/RevealTab";
import StatusTab from "./components/StatusTab";
import { EXPLORER_URL, SEADROP_ADDRESS, explorerAddressUrl } from "./config";

type Tab = "launch" | "reveal" | "status";

export default function App() {
  const [tab, setTab] = useState<Tab>("launch");

  return (
    <>
      <ConnectBar />
      <div className="tabs">
        {(["launch", "reveal", "status"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {tab === "launch" ? <LaunchTab /> : null}
      {tab === "reveal" ? <RevealTab /> : null}
      {tab === "status" ? <StatusTab /> : null}
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
        Creator tool for launching YOUR collections from YOUR wallet. No private
        keys, no minting bots, no auto-listing — signing happens only in your
        wallet extension.
      </div>
    </>
  );
}
