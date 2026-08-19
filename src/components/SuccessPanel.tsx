import { useEffect, useState } from "react";
import { openSeaCollectionUrl, xShareUrl } from "../config";
import { formatCountdown, unixToLocalAndUtc } from "../lib/convert";
import type { LaunchState } from "../lib/launchState";
import { AddrLink, TxLink } from "./Bits";

export default function SuccessPanel({
  state,
  onReset,
}: {
  state: LaunchState;
  onReset: () => void;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const address = state.contractAddress!;
  const start = unixToLocalAndUtc(state.startTime);

  return (
    <div>
      <div className="panel">
        <h2>Launched ✓</h2>
        <dl className="kv">
          <dt>contract</dt>
          <dd>
            <AddrLink address={address} />
          </dd>
          <dt>deploy tx</dt>
          <dd>{state.deployTxHash ? <TxLink hash={state.deployTxHash} /> : "—"}</dd>
          <dt>configure tx</dt>
          <dd>
            {state.configureTxHash ? <TxLink hash={state.configureTxHash} /> : "—"}
          </dd>
          {state.royaltyTxHash ? (
            <>
              <dt>royalty tx</dt>
              <dd>
                <TxLink hash={state.royaltyTxHash} />
              </dd>
            </>
          ) : null}
          {state.validatorTxHash ? (
            <>
              <dt>enforcement tx</dt>
              <dd>
                <TxLink hash={state.validatorTxHash} />
              </dd>
            </>
          ) : null}
          <dt>OpenSea</dt>
          <dd>
            <a href={openSeaCollectionUrl(address)} target="_blank" rel="noreferrer">
              {openSeaCollectionUrl(address)}
            </a>
            <div className="dim">
              (appears after OpenSea indexes the contract — usually minutes,
              sometimes longer on a young chain)
            </div>
          </dd>
          <dt>mint starts</dt>
          <dd>
            <span className="ok">{formatCountdown(state.startTime - now)}</span>
            <div className="dim">
              {start.local} · {start.utc}
            </div>
          </dd>
        </dl>
      </div>

      <div className="panel">
        <h2>Manual OpenSea Studio checklist</h2>
        <p className="dim">
          Everything on-chain is done. The cosmetic drop page on opensea.io
          cannot be automated — OpenSea Studio has no public API — so finish
          these clicks by hand:
        </p>
        <ol className="checklist">
          <li>
            Log into opensea.io with the SAME wallet that deployed (it&apos;s
            the collection owner).
          </li>
          <li>
            Wait for the collection to auto-appear after indexing (it&apos;s
            found via the SeaDrop events — no submission needed).
          </li>
          <li>
            Collection → Edit: upload logo &amp; banner, fix the description
            {state.royaltyTxHash ? "" : ", set creator royalties"}. The website
            link is already there if you set it at launch (contractURI
            external_link).
          </li>
          <li>
            Collection → Edit → Links: connect X (Twitter) and Discord — this
            is an OAuth flow that exists only in OpenSea&apos;s settings UI, so
            it can&apos;t be automated from here.
          </li>
          <li>
            Collection → Edit: switch the collection&apos;s trading currency
            from <b>USDG</b> (the Robinhood Chain default) to <b>ETH</b> if you
            want listings/floor denominated in ETH. This is an off-chain
            OpenSea marketplace preference — no contract field or API exists
            for it, so it&apos;s one manual toggle here.
          </li>
          <li>
            Optional: OpenSea Studio drop-page cosmetics (gallery, story
            sections) if you want a fancy drop page.
          </li>
          <li>
            After the Reveal, if items still show the placeholder: item page →
            … menu → Refresh metadata (the reveal already emits
            BatchMetadataUpdate, so this is rarely needed).
          </li>
        </ol>
      </div>

      <div className="panel">
        <h2>Socials</h2>
        <p className="dim">
          The X (Twitter) connection itself is an OAuth flow that only exists
          on opensea.io — no site can do it for you. These buttons take you
          straight to the right places:
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="secondary"
            onClick={() => window.open(openSeaCollectionUrl(address), "_blank")}
          >
            connect X → OpenSea: Edit → Links → Connect
          </button>
          <button
            className="secondary"
            onClick={() =>
              window.open(
                xShareUrl(
                  `${state.form.name} — minting on OpenSea. Mint opens ${
                    unixToLocalAndUtc(state.startTime).utc
                  }.`,
                  openSeaCollectionUrl(address),
                ),
                "_blank",
              )
            }
          >
            share the drop on X
          </button>
        </div>
        <p className="dim" style={{ marginBottom: 0 }}>
          The share button only opens X&apos;s composer with a prefilled post —
          you review and edit before anything is published.
        </p>
      </div>

      <div className="panel">
        <h2>Next</h2>
        <p>
          Keep this browser profile: the launch state is saved locally and the
          <b> Reveal</b> tab will use it when you&apos;re ready to upload the
          real art. The <b>Status</b> tab shows live mint progress and lets you
          change price/time/limit later.
        </p>
        <button className="danger" onClick={onReset}>
          clear saved launch (start a new one)
        </button>
      </div>
    </div>
  );
}
