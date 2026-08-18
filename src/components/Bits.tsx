import type { ReactNode } from "react";
import { explorerAddressUrl, explorerTxUrl, ipfsGatewayUrl } from "../config";

export function TxLink({ hash }: { hash: string }) {
  return (
    <a
      className="mono-break"
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
    >
      {hash}
    </a>
  );
}

export function AddrLink({ address }: { address: string }) {
  return (
    <a
      className="mono-break"
      href={explorerAddressUrl(address)}
      target="_blank"
      rel="noreferrer"
    >
      {address}
    </a>
  );
}

export function IpfsLink({ uri }: { uri: string }) {
  return (
    <a
      className="mono-break"
      href={ipfsGatewayUrl(uri)}
      target="_blank"
      rel="noreferrer"
    >
      {uri}
    </a>
  );
}

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepView {
  id: string;
  label: string;
  status: StepStatus;
  detail?: ReactNode;
  /** 0..1 upload progress while running. */
  progress?: number;
}

const MARKERS: Record<StepStatus, string> = {
  pending: "[ ]",
  running: "[~]",
  done: "[✓]",
  failed: "[✗]",
};

export function Steps({ steps }: { steps: StepView[] }) {
  return (
    <ul className="steps">
      {steps.map((s) => (
        <li key={s.id} className={s.status}>
          <span className="marker">{MARKERS[s.status]}</span>
          <span style={{ flex: 1 }}>
            {s.label}
            {s.status === "running" && s.progress !== undefined ? (
              <div className="progressbar">
                <div style={{ width: `${Math.round(s.progress * 100)}%` }} />
              </div>
            ) : null}
            {s.detail ? <div className="detail">{s.detail}</div> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
