import { openSeaCollectionUrl, TRANSFER_VALIDATOR, xShareUrl } from "../config";
import type { CollectionStatus } from "../lib/collectionData";
import { unixToLocalAndUtc, weiToEth } from "../lib/convert";
import {
  formatEthShort,
  formatUsdApprox,
  type ProfitBreakdown,
} from "../lib/profit";
import { AddrLink, IpfsLink } from "./Bits";

export interface ProfitView {
  loading: boolean;
  breakdown?: ProfitBreakdown;
  ethUsd: number | null;
  error?: string;
}

const ZERO = "0x0000000000000000000000000000000000000000";

export function CollectionDetail({
  contract,
  status,
  isOwner,
}: {
  contract: string;
  status: CollectionStatus;
  isOwner: boolean;
}) {
  const pd = status.publicDrop;
  const revealed = status.baseURI.endsWith("/");
  return (
    <dl className="kv">
      <dt>minted</dt>
      <dd>
        {status.totalSupply.toString()} / {status.maxSupply.toString()}
      </dd>
      <dt>price</dt>
      <dd>{pd.mintPrice === 0n ? "FREE" : `${weiToEth(pd.mintPrice)} ETH`}</dd>
      <dt>window</dt>
      <dd>
        {pd.startTime === 0 ? (
          <span className="warn">not configured</span>
        ) : (
          <>
            {unixToLocalAndUtc(pd.startTime).local} →{" "}
            {unixToLocalAndUtc(pd.endTime).local}
            <div className="dim">
              {unixToLocalAndUtc(pd.startTime).utc} →{" "}
              {unixToLocalAndUtc(pd.endTime).utc}
            </div>
          </>
        )}
      </dd>
      <dt>per wallet</dt>
      <dd>{pd.maxTotalMintableByWallet}</dd>
      <dt>fee</dt>
      <dd>
        {pd.feeBps / 100}% · restricted: {pd.restrictFeeRecipients ? "yes" : "no"} ·
        recipients: {status.allowedFeeRecipients.length}
      </dd>
      <dt>royalties</dt>
      <dd>
        {status.royaltyBps > 0 ? (
          <>
            {status.royaltyBps / 100}% → {status.royaltyReceiver.slice(0, 10)}…{" "}
            {status.transferValidator === TRANSFER_VALIDATOR ? (
              <span className="ok">[ENFORCED — OpenSea validator]</span>
            ) : status.transferValidator !== ZERO ? (
              <span className="warn">
                [custom validator {status.transferValidator.slice(0, 10)}…]
              </span>
            ) : (
              <span className="warn">[signal only — not enforced]</span>
            )}
          </>
        ) : (
          "not set (ERC-2981)"
        )}
      </dd>
      <dt>owner</dt>
      <dd>
        <AddrLink address={status.owner} />
        {isOwner ? <span className="ok"> (you)</span> : null}
      </dd>
      <dt>payout</dt>
      <dd>
        <AddrLink address={status.creatorPayout} />
        <div className="dim">
          mint proceeds stream here automatically — nothing to withdraw
        </div>
      </dd>
      <dt>baseURI</dt>
      <dd>
        {status.baseURI ? <IpfsLink uri={status.baseURI} /> : "—"}{" "}
        <span className={revealed ? "ok" : "warn"}>
          {revealed ? "(revealed)" : "(pre-reveal)"}
        </span>
      </dd>
      <dt>contractURI</dt>
      <dd>{status.contractURI ? <IpfsLink uri={status.contractURI} /> : "—"}</dd>
      <dt>provenance</dt>
      <dd>{/^0x0+$/.test(status.provenanceHash) ? "not set" : status.provenanceHash}</dd>
      <dt>links</dt>
      <dd>
        <a href={openSeaCollectionUrl(contract)} target="_blank" rel="noreferrer">
          OpenSea
        </a>{" "}
        · <AddrLink address={contract} /> ·{" "}
        <a
          href={xShareUrl(`${status.name} — live on OpenSea.`, openSeaCollectionUrl(contract))}
          target="_blank"
          rel="noreferrer"
        >
          share on X
        </a>
        {isOwner ? (
          <div className="dim">
            connect X (Twitter): OpenSea → collection → Edit → Links → Connect
            (OAuth — only possible on opensea.io)
          </div>
        ) : null}
      </dd>
    </dl>
  );
}

export function ProfitBlock({
  b,
  ethUsd,
}: {
  b: ProfitBreakdown;
  ethUsd: number | null;
}) {
  const pos = b.profit >= 0n;
  const usd = formatUsdApprox(b.profit, ethUsd);
  return (
    <>
      <div className={`profit-big ${pos ? "profit-pos" : "profit-neg"}`}>
        {pos ? "▲ +" : "▼ "}
        {formatEthShort(b.profit)} ETH
        {usd ? <span className="profit-usd">{usd}</span> : null}
      </div>
      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>mint proceeds</dt>
        <dd>
          <span className="ok">+{formatEthShort(b.mint.creator)} ETH</span>{" "}
          <span className="dim">
            {b.mint.mintedViaSeaDrop.toString()} minted · gross{" "}
            {formatEthShort(b.mint.gross)} − OpenSea&apos;s cut{" "}
            {formatEthShort(b.mint.openSeaFee)}
          </span>
        </dd>
        <dt>royalties</dt>
        <dd>
          <span className="ok">+{formatEthShort(b.royalties)} ETH</span>{" "}
          <span className="dim">
            received via OpenSea/Seaport payouts
            {b.royaltiesTruncated ? " (first 250 payouts counted)" : ""}
          </span>
        </dd>
        <dt>launch cost</dt>
        <dd>
          <span className="error">−{formatEthShort(b.launchCost, 6)} ETH</span>{" "}
          <span className="dim">
            gas paid
            {b.launchCostComplete ? "" : " (deploy tx only — launch not made from this browser)"}
          </span>
        </dd>
      </dl>
      <p className="dim" style={{ marginBottom: 0, fontSize: 11 }}>
        Mint numbers are exact (decoded from SeaDrop mint events, already net of
        OpenSea&apos;s drop fee). Royalties are an estimate: every Seaport payout
        to the royalty address counts, so other collections or sales from the
        same wallet inflate it. Amounts are what actually reached the wallet.
      </p>
    </>
  );
}
