import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { zeroAddress } from "viem";
import { useSigner } from "../signer";
import { CHAINS_BY_ID, DEFAULT_CHAIN_ID, openSeaItemUrl } from "../chains";
import { seaDropAbi, tokenAbi } from "../contracts/seadrop";
import { formatCountdown, parseCollectionInput, weiToEth } from "../lib/convert";
import { formatEthShort } from "../lib/profit";
import { TxLink } from "./Bits";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface MintTarget {
  address: `0x${string}`;
  name: string;
  totalSupply: bigint;
  maxSupply: bigint;
  price: bigint;
  startTime: number;
  endTime: number;
  perWallet: number;
  restrictFeeRecipients: boolean;
  allowedFeeRecipients: readonly string[];
}

type DropPhase = "unconfigured" | "pending" | "live" | "ended" | "soldout";

function phaseOf(t: MintTarget, now: number): DropPhase {
  if (t.startTime === 0) return "unconfigured";
  if (t.totalSupply >= t.maxSupply) return "soldout";
  if (now < t.startTime) return "pending";
  if (now > t.endTime) return "ended";
  return "live";
}

export default function MintTab() {
  const { address, txAccount, isConnected, walletClient, wrongNetwork, chainInfo } =
    useSigner();
  const publicClient = usePublicClient({ chainId: chainInfo?.id });

  const [input, setInput] = useState("");
  const [target, setTarget] = useState<MintTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [minting, setMinting] = useState(false);
  const [mintedIds, setMintedIds] = useState<bigint[] | null>(null);
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const phase = target ? phaseOf(target, now) : null;

  async function load() {
    const parsed = parseCollectionInput(input);
    if (!parsed) {
      setError("Paste a collection contract address or an OpenSea/Blockscout link");
      return;
    }
    if (!publicClient || !chainInfo) {
      setError("Select a supported network first");
      return;
    }
    const seaDrop = chainInfo.seaDrop;
    setLoading(true);
    setError(null);
    setTarget(null);
    setMintedIds(null);
    setMintTx(null);
    try {
      const read = <T,>(functionName: string): Promise<T> =>
        publicClient.readContract({
          address: parsed,
          abi: tokenAbi,
          functionName,
        } as never) as Promise<T>;
      const [name, totalSupply, maxSupply] = await Promise.all([
        read<string>("name"),
        read<bigint>("totalSupply"),
        read<bigint>("maxSupply"),
      ]);
      const [publicDrop, allowedFeeRecipients] = await Promise.all([
        publicClient.readContract({
          address: seaDrop,
          abi: seaDropAbi,
          functionName: "getPublicDrop",
          args: [parsed],
        }),
        publicClient.readContract({
          address: seaDrop,
          abi: seaDropAbi,
          functionName: "getAllowedFeeRecipients",
          args: [parsed],
        }),
      ]);
      setTarget({
        address: parsed,
        name,
        totalSupply,
        maxSupply,
        price: publicDrop.mintPrice,
        startTime: Number(publicDrop.startTime),
        endTime: Number(publicDrop.endTime),
        perWallet: Number(publicDrop.maxTotalMintableByWallet),
        restrictFeeRecipients: publicDrop.restrictFeeRecipients,
        allowedFeeRecipients,
      });
      setQuantity(1);
    } catch (e) {
      setError(
        `Could not read this collection — is it a SeaDrop drop on ${chainInfo.label}? (${
          e instanceof Error ? e.message.split("\n")[0] : e
        })`,
      );
    } finally {
      setLoading(false);
    }
  }

  function pickFeeRecipient(t: MintTarget): `0x${string}` | null {
    const openSeaFee = chainInfo?.feeRecipient;
    const allowed = t.allowedFeeRecipients.map((a) => a.toLowerCase());
    if (openSeaFee && !t.restrictFeeRecipients) return openSeaFee;
    if (openSeaFee && allowed.includes(openSeaFee.toLowerCase())) return openSeaFee;
    if (t.allowedFeeRecipients.length > 0)
      return t.allowedFeeRecipients[0] as `0x${string}`;
    return null;
  }

  async function mint() {
    if (!target || !walletClient || !publicClient || !address || !txAccount || !chainInfo)
      return;
    setMinting(true);
    setError(null);
    setMintedIds(null);
    setMintTx(null);
    try {
      const feeRecipient = pickFeeRecipient(target);
      if (!feeRecipient) {
        throw new Error("This drop restricts fee recipients and allows none — cannot mint");
      }
      const value = target.price * BigInt(quantity);
      const { request } = await publicClient.simulateContract({
        address: chainInfo.seaDrop,
        abi: seaDropAbi,
        functionName: "mintPublic",
        args: [target.address, feeRecipient, zeroAddress, BigInt(quantity)],
        account: txAccount,
        value,
      });
      const hash = await walletClient.writeContract(request);
      setMintTx(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Mint reverted (${hash})`);
      const ids = receipt.logs
        .filter(
          (l) =>
            l.address.toLowerCase() === target.address.toLowerCase() &&
            l.topics[0] === TRANSFER_TOPIC &&
            l.topics[1] ===
              "0x0000000000000000000000000000000000000000000000000000000000000000",
        )
        .map((l) => BigInt(l.topics[3]!));
      setMintedIds(ids);
      // Refresh minted counter.
      const totalSupply = (await publicClient.readContract({
        address: target.address,
        abi: tokenAbi,
        functionName: "totalSupply",
      })) as bigint;
      setTarget({ ...target, totalSupply });
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n").slice(0, 2).join(" ") : String(e));
    } finally {
      setMinting(false);
    }
  }

  const totalCost = target ? target.price * BigInt(quantity || 0) : 0n;

  return (
    <div>
      <div className="panel">
        <h2>Quick mint</h2>
        <p className="dim">
          Manual public mint from YOUR connected wallet — one wallet, one click,
          the same call the drop page makes. No automation, no sniping, no
          multi-wallet.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="collection address or OpenSea link (opensea.io/assets/robinhood/0x…)"
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
          <button className="secondary" onClick={load} disabled={loading}>
            {loading ? "reading…" : "read"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>

      {target && phase ? (
        <div className="panel">
          <h2>{target.name}</h2>
          <dl className="kv">
            <dt>minted</dt>
            <dd>
              {target.totalSupply.toString()} / {target.maxSupply.toString()}
            </dd>
            <dt>price</dt>
            <dd>{target.price === 0n ? "FREE" : `${weiToEth(target.price)} ETH each`}</dd>
            <dt>per wallet</dt>
            <dd>max {target.perWallet}</dd>
            <dt>status</dt>
            <dd>
              {phase === "live" ? (
                <span className="ok">
                  LIVE — ends in {formatCountdown(target.endTime - now)}
                </span>
              ) : phase === "pending" ? (
                <span className="warn">
                  starts in {formatCountdown(target.startTime - now)}
                </span>
              ) : phase === "ended" ? (
                <span className="error">ended</span>
              ) : phase === "soldout" ? (
                <span className="warn">SOLD OUT</span>
              ) : (
                <span className="warn">public drop not configured</span>
              )}
            </dd>
          </dl>

          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginTop: 12 }}>
            <div className="field" style={{ width: 130 }}>
              <label>quantity (max {target.perWallet})</label>
              <input
                type="number"
                min={1}
                max={target.perWallet}
                value={quantity}
                onChange={(e) =>
                  setQuantity(
                    Math.max(1, Math.min(target.perWallet, Number(e.target.value) || 1)),
                  )
                }
              />
            </div>
            <button
              className="primary"
              style={{ padding: "10px 32px" }}
              disabled={!isConnected || wrongNetwork || phase !== "live" || minting}
              onClick={mint}
            >
              {minting
                ? "minting…"
                : !isConnected
                  ? "CONNECT WALLET"
                  : wrongNetwork
                    ? "SWITCH NETWORK"
                    : `MINT ${quantity} — ${totalCost === 0n ? "FREE" : `${formatEthShort(totalCost)} ETH`}`}
            </button>
          </div>
          <p className="hint dim" style={{ marginBottom: 0 }}>
            The contract enforces the per-wallet limit; the OpenSea drop fee is
            part of the mint price, not on top of it.
          </p>
        </div>
      ) : null}

      {mintTx ? (
        <div className="panel">
          <h2>Mint result</h2>
          <dl className="kv">
            <dt>tx</dt>
            <dd>
              <TxLink hash={mintTx} />
            </dd>
            {mintedIds && mintedIds.length > 0 ? (
              <>
                <dt>minted</dt>
                <dd>
                  {mintedIds.map((id) => (
                    <div key={id.toString()}>
                      #{id.toString()} —{" "}
                      <a
                        href={openSeaItemUrl(chainInfo ?? CHAINS_BY_ID.get(DEFAULT_CHAIN_ID)!, target!.address, id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        view on OpenSea
                      </a>{" "}
                      ·{" "}
                      <a
                        href={openSeaItemUrl(chainInfo ?? CHAINS_BY_ID.get(DEFAULT_CHAIN_ID)!, target!.address, id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        sell (opens item page → Sell)
                      </a>
                    </div>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
          <p className="dim" style={{ marginBottom: 0 }}>
            Listing happens on opensea.io: the item page&apos;s <b>Sell</b>{" "}
            button lets you set the price, and the wallet will ask for a
            one-time approval on first listing. In-app listing isn&apos;t
            possible from a keyless static app — OpenSea&apos;s order book API
            requires an API key and a backend, and LaunchPad deliberately has
            neither.
          </p>
        </div>
      ) : null}
    </div>
  );
}
