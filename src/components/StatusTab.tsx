import { useMemo, useState, type ReactNode } from "react";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { parseAbiItem, zeroAddress } from "viem";
import {
  BLOCKSCOUT_API,
  CHAIN_ID,
  OPENSEA_FEE_BPS,
  SEADROP_ADDRESS,
  SEAPORT_1_6,
  TRANSFER_VALIDATOR,
  openSeaCollectionUrl,
  xShareUrl,
} from "../config";
import {
  computeMintRevenue,
  computeProfit,
  formatEthShort,
  formatUsdApprox,
  sumSeaportPayouts,
  type InternalTxItem,
  type ProfitBreakdown,
} from "../lib/profit";
import { seaDropAbi, tokenAbi } from "../contracts/seadrop";
import {
  datetimeLocalToUnix,
  ethToWei,
  isAddress,
  UINT16_MAX,
  unixToLocalAndUtc,
  weiToEth,
} from "../lib/convert";
import { loadLaunchState } from "../lib/launchState";
import { AddrLink, IpfsLink, TxLink } from "./Bits";

interface DropStatus {
  name: string;
  symbol: string;
  owner: string;
  totalSupply: bigint;
  maxSupply: bigint;
  baseURI: string;
  contractURI: string;
  provenanceHash: string;
  publicDrop: {
    mintPrice: bigint;
    startTime: number;
    endTime: number;
    maxTotalMintableByWallet: number;
    feeBps: number;
    restrictFeeRecipients: boolean;
  };
  creatorPayout: string;
  allowedFeeRecipients: readonly string[];
  royaltyReceiver: string;
  royaltyBps: number;
  transferValidator: string;
}

interface ProfitView {
  loading: boolean;
  breakdown?: ProfitBreakdown;
  ethUsd: number | null;
  error?: string;
}

const seaDropMintEvent = parseAbiItem(
  "event SeaDropMint(address indexed nftContract, address indexed minter, address indexed feeRecipient, address payer, uint256 quantityMinted, uint256 unitMintPrice, uint256 feeBps, uint256 dropStageIndex)",
);

export default function StatusTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const saved = useMemo(loadLaunchState, []);
  const [contract, setContract] = useState(saved?.contractAddress ?? "");
  const [status, setStatus] = useState<DropStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profit, setProfit] = useState<ProfitView | null>(null);

  // Owner action form state
  const [newPrice, setNewPrice] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newLimit, setNewLimit] = useState("");
  const [newMaxSupply, setNewMaxSupply] = useState("");
  const [actionMsg, setActionMsg] = useState<ReactNode>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const isOwner =
    status && address && status.owner.toLowerCase() === address.toLowerCase();
  const wrongNetwork = isConnected && chainId !== CHAIN_ID;
  const revealed = status ? status.baseURI.endsWith("/") : false;

  async function load() {
    if (!isAddress(contract)) {
      setError("Enter a valid contract address");
      return;
    }
    if (!publicClient) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const target = contract as `0x${string}`;
      const read = <T,>(functionName: string): Promise<T> =>
        publicClient.readContract({
          address: target,
          abi: tokenAbi,
          functionName,
        } as never) as Promise<T>;
      const [
        name,
        symbol,
        owner,
        totalSupply,
        maxSupply,
        baseURI,
        contractURI,
        provenanceHash,
      ] = await Promise.all([
        read<string>("name"),
        read<string>("symbol"),
        read<string>("owner"),
        read<bigint>("totalSupply"),
        read<bigint>("maxSupply"),
        read<string>("baseURI"),
        read<string>("contractURI"),
        read<string>("provenanceHash"),
      ]);
      const [royaltyReceiver, royaltyAmount] = (await publicClient.readContract({
        address: target,
        abi: tokenAbi,
        functionName: "royaltyInfo",
        args: [1n, 10_000n],
      })) as readonly [string, bigint];
      const transferValidator = (await publicClient.readContract({
        address: target,
        abi: tokenAbi,
        functionName: "getTransferValidator",
      })) as string;
      const [publicDrop, creatorPayout, allowedFeeRecipients] = await Promise.all([
        publicClient.readContract({
          address: SEADROP_ADDRESS,
          abi: seaDropAbi,
          functionName: "getPublicDrop",
          args: [target],
        }),
        publicClient.readContract({
          address: SEADROP_ADDRESS,
          abi: seaDropAbi,
          functionName: "getCreatorPayoutAddress",
          args: [target],
        }),
        publicClient.readContract({
          address: SEADROP_ADDRESS,
          abi: seaDropAbi,
          functionName: "getAllowedFeeRecipients",
          args: [target],
        }),
      ]);
      const s: DropStatus = {
        name,
        symbol,
        owner,
        totalSupply,
        maxSupply,
        baseURI,
        contractURI,
        provenanceHash,
        publicDrop: {
          mintPrice: publicDrop.mintPrice,
          startTime: Number(publicDrop.startTime),
          endTime: Number(publicDrop.endTime),
          maxTotalMintableByWallet: Number(publicDrop.maxTotalMintableByWallet),
          feeBps: Number(publicDrop.feeBps),
          restrictFeeRecipients: publicDrop.restrictFeeRecipients,
        },
        creatorPayout,
        allowedFeeRecipients,
        royaltyReceiver,
        royaltyBps: Number(royaltyAmount),
        transferValidator,
      };
      setStatus(s);
      void loadProfit(target, s);
      setNewPrice(weiToEth(s.publicDrop.mintPrice));
      setNewLimit(String(s.publicDrop.maxTotalMintableByWallet));
      setNewStart("");
      setNewEnd("");
      setNewMaxSupply("");
    } catch (e) {
      setError(
        `Could not read drop state — is this an ERC721SeaDrop on Robinhood Chain? (${
          e instanceof Error ? e.message.split("\n")[0] : e
        })`,
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * Profit = creator mint proceeds (exact, from SeaDropMint events) +
   * royalties received (estimate, Seaport → royalty receiver internal txs)
   * − launch cost (gas of the deploy/configure/reveal txs we know about).
   */
  async function loadProfit(target: `0x${string}`, s: DropStatus) {
    if (!publicClient) return;
    setProfit({ loading: true, ethUsd: null });
    try {
      // 1. Mint revenue — exact, from SeaDrop's mint events for THIS contract.
      const logs = await publicClient.getLogs({
        address: SEADROP_ADDRESS,
        event: seaDropMintEvent,
        args: { nftContract: target },
        fromBlock: 0n,
        toBlock: "latest",
      });
      const mint = computeMintRevenue(
        logs.map((l) => ({
          quantity: l.args.quantityMinted!,
          unitPrice: l.args.unitMintPrice!,
          feeBps: l.args.feeBps!,
        })),
      );

      // 2. Royalties — internal native transfers Seaport 1.6 → royalty receiver.
      let royalties = 0n;
      let royaltiesTruncated = false;
      if (s.royaltyBps > 0 && s.royaltyReceiver !== zeroAddress) {
        let query = "filter=to";
        for (let page = 0; page < 5; page++) {
          const res = await fetch(
            `${BLOCKSCOUT_API}/addresses/${s.royaltyReceiver}/internal-transactions?${query}`,
          );
          if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
          const data = (await res.json()) as {
            items: InternalTxItem[];
            next_page_params: Record<string, string | number> | null;
          };
          royalties += sumSeaportPayouts(data.items, SEAPORT_1_6, s.royaltyReceiver);
          if (!data.next_page_params) break;
          if (page === 4) {
            royaltiesTruncated = true;
            break;
          }
          query =
            "filter=to&" +
            new URLSearchParams(
              Object.fromEntries(
                Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)]),
              ),
            ).toString();
        }
      }

      // 3. Launch cost — gas actually paid for the txs we can attribute.
      const savedState = loadLaunchState();
      const mine = savedState?.contractAddress?.toLowerCase() === target.toLowerCase();
      const hashes = new Set<string>();
      const creationRes = await fetch(`${BLOCKSCOUT_API}/addresses/${target}`);
      if (creationRes.ok) {
        const info = (await creationRes.json()) as {
          creation_transaction_hash?: string | null;
          creation_tx_hash?: string | null;
        };
        const h = info.creation_transaction_hash ?? info.creation_tx_hash;
        if (h) hashes.add(h);
      }
      if (mine && savedState) {
        for (const h of [
          savedState.deployTxHash,
          savedState.configureTxHash,
          savedState.royaltyTxHash,
          savedState.validatorTxHash,
          savedState.revealTxHash,
        ]) {
          if (h) hashes.add(h);
        }
      }
      let launchCost = 0n;
      for (const h of hashes) {
        try {
          const receipt = await publicClient.getTransactionReceipt({
            hash: h as `0x${string}`,
          });
          launchCost += receipt.gasUsed * receipt.effectiveGasPrice;
        } catch {
          // Receipt not found (pruned/wrong hash) — skip, flagged as incomplete.
        }
      }

      // 4. USD approximation for the fun factor.
      let ethUsd: number | null = null;
      try {
        const statsRes = await fetch(`${BLOCKSCOUT_API}/stats`);
        if (statsRes.ok) {
          const price = Number(((await statsRes.json()) as { coin_price?: string }).coin_price);
          ethUsd = Number.isFinite(price) ? price : null;
        }
      } catch {
        ethUsd = null;
      }

      setProfit({
        loading: false,
        ethUsd,
        breakdown: computeProfit({
          mint,
          royalties,
          royaltiesTruncated,
          launchCost,
          launchCostComplete: mine,
        }),
      });
    } catch (e) {
      setProfit({
        loading: false,
        ethUsd: null,
        error: e instanceof Error ? e.message.split("\n")[0] : String(e),
      });
    }
  }

  async function sendUpdatePublicDrop() {
    if (!status || !walletClient || !publicClient || !address) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const mintPrice = ethToWei(newPrice || "0");
      const startTime = newStart
        ? datetimeLocalToUnix(newStart)
        : status.publicDrop.startTime;
      const endTime = newEnd ? datetimeLocalToUnix(newEnd) : status.publicDrop.endTime;
      const limit = Number(newLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > UINT16_MAX) {
        throw new Error(`Per-wallet limit must be 1..${UINT16_MAX}`);
      }
      if (endTime <= startTime) throw new Error("End time must be after start time");
      const { request } = await publicClient.simulateContract({
        address: contract as `0x${string}`,
        abi: tokenAbi,
        functionName: "updatePublicDrop",
        args: [
          SEADROP_ADDRESS,
          {
            mintPrice,
            startTime,
            endTime,
            maxTotalMintableByWallet: limit,
            feeBps: status.publicDrop.feeBps || OPENSEA_FEE_BPS,
            restrictFeeRecipients: true,
          },
        ],
        account: address,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      setActionMsg(
        <span className="ok">
          updatePublicDrop confirmed: <TxLink hash={hash} />
        </span>,
      );
      await load();
    } catch (e) {
      setActionMsg(<span className="error">{(e as Error).message}</span>);
    } finally {
      setActionBusy(false);
    }
  }

  async function sendSetValidator(enable: boolean) {
    if (!status || !walletClient || !publicClient || !address) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const { request } = await publicClient.simulateContract({
        address: contract as `0x${string}`,
        abi: tokenAbi,
        functionName: "setTransferValidator",
        args: [enable ? TRANSFER_VALIDATOR : zeroAddress],
        account: address,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      setActionMsg(
        <span className="ok">
          setTransferValidator confirmed: <TxLink hash={hash} />
        </span>,
      );
      await load();
    } catch (e) {
      setActionMsg(<span className="error">{(e as Error).message}</span>);
    } finally {
      setActionBusy(false);
    }
  }

  async function sendSetMaxSupply() {
    if (!status || !walletClient || !publicClient || !address) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const n = Number(newMaxSupply);
      if (!Number.isInteger(n) || n < 1) throw new Error("Enter a whole number");
      if (BigInt(n) < status.totalSupply) {
        throw new Error(
          `Cannot set maxSupply below what's already minted (${status.totalSupply})`,
        );
      }
      const { request } = await publicClient.simulateContract({
        address: contract as `0x${string}`,
        abi: tokenAbi,
        functionName: "setMaxSupply",
        args: [BigInt(n)],
        account: address,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      setActionMsg(
        <span className="ok">
          setMaxSupply confirmed: <TxLink hash={hash} />
        </span>,
      );
      await load();
    } catch (e) {
      setActionMsg(<span className="error">{(e as Error).message}</span>);
    } finally {
      setActionBusy(false);
    }
  }

  const pd = status?.publicDrop;

  return (
    <div>
      <div className="panel">
        <h2>Drop status</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={contract}
            onChange={(e) => setContract(e.target.value.trim())}
            placeholder="0x… (prefilled from saved launch)"
          />
          <button className="secondary" onClick={load} disabled={loading}>
            {loading ? "reading…" : "read"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>

      {status && pd ? (
        <>
          <div className="panel">
            <h2>
              {status.name} ({status.symbol})
            </h2>
            <dl className="kv">
              <dt>minted</dt>
              <dd>
                {status.totalSupply.toString()} / {status.maxSupply.toString()}
              </dd>
              <dt>price</dt>
              <dd>
                {pd.mintPrice === 0n ? "FREE" : `${weiToEth(pd.mintPrice)} ETH`}
              </dd>
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
                {pd.feeBps / 100}% · restricted:{" "}
                {pd.restrictFeeRecipients ? "yes" : "no"} · recipients:{" "}
                {status.allowedFeeRecipients.length}
              </dd>
              <dt>royalties</dt>
              <dd>
                {status.royaltyBps > 0 ? (
                  <>
                    {status.royaltyBps / 100}% →{" "}
                    {status.royaltyReceiver.slice(0, 10)}…{" "}
                    {status.transferValidator === TRANSFER_VALIDATOR ? (
                      <span className="ok">[ENFORCED — OpenSea validator]</span>
                    ) : status.transferValidator !== "0x0000000000000000000000000000000000000000" ? (
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
              <dd>
                {/^0x0+$/.test(status.provenanceHash)
                  ? "not set"
                  : status.provenanceHash}
              </dd>
              <dt>links</dt>
              <dd>
                <a
                  href={openSeaCollectionUrl(contract)}
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenSea
                </a>{" "}
                · <AddrLink address={contract} /> ·{" "}
                <a
                  href={xShareUrl(
                    `${status.name} — live on OpenSea.`,
                    openSeaCollectionUrl(contract),
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  share on X
                </a>
                {isOwner ? (
                  <div className="dim">
                    connect X (Twitter): OpenSea → collection → Edit → Links →
                    Connect (OAuth — only possible on opensea.io)
                  </div>
                ) : null}
              </dd>
            </dl>
          </div>

          <div className="panel">
            <h2>Profit</h2>
            {!profit || profit.loading ? (
              <p className="dim">computing from on-chain data…</p>
            ) : profit.error ? (
              <p className="error">Could not compute profit: {profit.error}</p>
            ) : profit.breakdown ? (
              <ProfitBlock b={profit.breakdown} ethUsd={profit.ethUsd} />
            ) : null}
          </div>

          {isOwner ? (
            <div className="panel">
              <h2>Owner actions</h2>
              {wrongNetwork ? (
                <p className="warn">Switch to Robinhood Chain to send transactions.</p>
              ) : null}
              <div className="grid">
                <div className="field">
                  <label>new price (ETH)</label>
                  <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
                </div>
                <div className="field">
                  <label>new per-wallet limit</label>
                  <input value={newLimit} onChange={(e) => setNewLimit(e.target.value)} />
                </div>
                <div className="field">
                  <label>new start (empty = keep)</label>
                  <input
                    type="datetime-local"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>new end (empty = keep)</label>
                  <input
                    type="datetime-local"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                  />
                </div>
              </div>
              <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="secondary"
                  disabled={actionBusy || wrongNetwork}
                  onClick={sendUpdatePublicDrop}
                >
                  updatePublicDrop
                </button>
                <button
                  className="secondary"
                  disabled={actionBusy || wrongNetwork}
                  onClick={() =>
                    sendSetValidator(status.transferValidator === "0x0000000000000000000000000000000000000000")
                  }
                >
                  {status.transferValidator === "0x0000000000000000000000000000000000000000"
                    ? "enforce royalties (set OpenSea validator)"
                    : "disable enforcement (validator → 0x0)"}
                </button>
              </p>
              <div className="grid">
                <div className="field">
                  <label>
                    new maxSupply (cut supply after mint slows — cannot go below
                    minted)
                  </label>
                  <input
                    value={newMaxSupply}
                    onChange={(e) => setNewMaxSupply(e.target.value)}
                    placeholder={status.maxSupply.toString()}
                  />
                </div>
                <div className="field" style={{ justifyContent: "end" }}>
                  <button
                    className="danger"
                    disabled={actionBusy || wrongNetwork || !newMaxSupply}
                    onClick={sendSetMaxSupply}
                  >
                    setMaxSupply
                  </button>
                </div>
              </div>
              {actionMsg ? <p>{actionMsg}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ProfitBlock({ b, ethUsd }: { b: ProfitBreakdown; ethUsd: number | null }) {
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
            gas paid{b.launchCostComplete ? "" : " (deploy tx only — launch not made from this browser)"}
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
