import { useMemo, useState, type ReactNode } from "react";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import {
  CHAIN_ID,
  OPENSEA_FEE_BPS,
  SEADROP_ADDRESS,
  openSeaCollectionUrl,
} from "../config";
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
}

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
      };
      setStatus(s);
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
                · <AddrLink address={contract} />
              </dd>
            </dl>
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
              <p>
                <button
                  className="secondary"
                  disabled={actionBusy || wrongNetwork}
                  onClick={sendUpdatePublicDrop}
                >
                  updatePublicDrop
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
