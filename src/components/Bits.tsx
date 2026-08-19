import type { ReactNode } from "react";
import {
  CHAINS_BY_ID,
  DEFAULT_CHAIN_ID,
  explorerAddressUrl,
  explorerTxUrl,
  ipfsGatewayUrl,
} from "../chains";
import { useActiveChain } from "../signer";

/** Active chain, falling back to the default so links still resolve. */
function useLinkChain() {
  return useActiveChain() ?? CHAINS_BY_ID.get(DEFAULT_CHAIN_ID)!;
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  const info = useLinkChain();
  return (
    <a
      className={label ? undefined : "mono-break"}
      href={explorerTxUrl(info, hash)}
      target="_blank"
      rel="noreferrer"
    >
      {label ?? hash}
    </a>
  );
}

export function AddrLink({ address }: { address: string }) {
  const info = useLinkChain();
  return (
    <a
      className="mono-break"
      href={explorerAddressUrl(info, address)}
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
