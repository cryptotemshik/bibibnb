import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { zeroHash } from "viem";
import {
  CHAIN_ID,
  DEFAULT_DROP_DAYS,
  OPENSEA_FEE_BPS,
  OPENSEA_FEE_RECIPIENT,
  SEADROP_ADDRESS,
  TRANSFER_VALIDATOR,
  openSeaCollectionUrl,
  robinhoodChain,
} from "../config";
import {
  erc721SeaDropAbi,
  erc721SeaDropBytecode,
  tokenAbi,
} from "../contracts/seadrop";
import {
  datetimeLocalToUnix,
  ethToWei,
  isAddress,
  normalizeProvenanceHash,
  nowPlusMinutesLocalInput,
  UINT16_MAX,
  unixToLocalAndUtc,
  weiToEth,
} from "../lib/convert";
import { pinFile, pinJson, testPinataJwt } from "../lib/pinata";
import {
  clearLaunchState,
  loadLaunchState,
  saveLaunchState,
  updateLaunchState,
  type LaunchFormValues,
  type LaunchState,
} from "../lib/launchState";
import { AddrLink, IpfsLink, Steps, TxLink, type StepView } from "./Bits";
import SuccessPanel from "./SuccessPanel";

const EMPTY_FORM: LaunchFormValues = {
  name: "",
  symbol: "",
  description: "",
  websiteUrl: "",
  supply: 0,
  mintPriceEth: "0",
  perWalletLimit: 0,
  startLocal: "",
  endLocal: "",
  provenanceHash: "",
  royaltyPercent: "",
  enforcedRoyalties: false,
  creatorPayoutAddress: "",
};

interface DerivedParams {
  priceWei: bigint;
  startTime: number;
  endTime: number;
  provenance: `0x${string}` | null;
  royaltyBps: number | null;
  payout: `0x${string}`;
}

function deriveAndValidate(
  form: LaunchFormValues,
  jwt: string,
  imageFile: File | null,
  resuming: LaunchState | null,
): { params?: DerivedParams; errors: string[] } {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("Collection name is required");
  if (!form.symbol.trim()) errors.push("Symbol is required");
  if (!Number.isInteger(form.supply) || form.supply < 1)
    errors.push("Supply must be a whole number ≥ 1");
  if (form.supply > 100_000)
    errors.push("Supply > 100,000 — double-check, that is unusually large");
  if (
    !Number.isInteger(form.perWalletLimit) ||
    form.perWalletLimit < 1 ||
    form.perWalletLimit > UINT16_MAX
  )
    errors.push(`Per-wallet limit must be 1..${UINT16_MAX}`);
  if (!jwt.trim()) errors.push("Pinata JWT is required (kept in memory only)");
  if (
    form.websiteUrl.trim() !== "" &&
    !/^https?:\/\/.+\..+/.test(form.websiteUrl.trim())
  )
    errors.push("Website must be a full URL (https://…)");
  if (!imageFile && !resuming?.prerevealImageCid)
    errors.push("Pre-reveal image is required");

  let priceWei = 0n;
  try {
    priceWei = ethToWei(form.mintPriceEth || "0");
  } catch (e) {
    errors.push((e as Error).message);
  }

  let startTime = 0;
  let endTime = 0;
  try {
    if (!form.startLocal) throw new Error("Start time is required");
    startTime = datetimeLocalToUnix(form.startLocal);
    if (startTime < Math.floor(Date.now() / 1000) - 300)
      errors.push("Start time is in the past");
  } catch (e) {
    errors.push((e as Error).message);
  }
  try {
    endTime = form.endLocal
      ? datetimeLocalToUnix(form.endLocal)
      : startTime + DEFAULT_DROP_DAYS * 86_400;
    if (startTime && endTime <= startTime)
      errors.push("End time must be after start time");
  } catch (e) {
    errors.push((e as Error).message);
  }

  let provenance: `0x${string}` | null = null;
  try {
    provenance = normalizeProvenanceHash(form.provenanceHash);
  } catch (e) {
    errors.push((e as Error).message);
  }

  let royaltyBps: number | null = null;
  if (form.royaltyPercent.trim() !== "") {
    const pct = Number(form.royaltyPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      errors.push("Royalty % must be between 0 and 100");
    } else {
      royaltyBps = Math.round(pct * 100);
      if (royaltyBps === 0) royaltyBps = null;
    }
  }
  if (form.enforcedRoyalties && !royaltyBps) {
    errors.push(
      "Enforced royalties need a royalty % above zero (or switch back to 'signal only')",
    );
  }

  const payout = form.creatorPayoutAddress.trim();
  if (!isAddress(payout)) errors.push("Creator payout address is not a valid address");

  if (errors.length > 0) return { errors };
  return {
    errors,
    params: {
      priceWei,
      startTime,
      endTime,
      provenance,
      royaltyBps,
      payout: payout as `0x${string}`,
    },
  };
}

type Phase = "form" | "confirm" | "running" | "done";

export default function LaunchTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const saved = useMemo(loadLaunchState, []);
  const [form, setForm] = useState<LaunchFormValues>(() => ({
    ...EMPTY_FORM,
    startLocal: nowPlusMinutesLocalInput(60),
    ...(saved && !saved.completedAt ? saved.form : {}),
  }));
  const [jwt, setJwt] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [phase, setPhase] = useState<Phase>(
    saved?.completedAt && saved.contractAddress ? "done" : "form",
  );
  const [steps, setSteps] = useState<StepView[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [state, setState] = useState<LaunchState | null>(saved);
  const [derived, setDerived] = useState<DerivedParams | null>(null);

  const wrongNetwork = isConnected && chainId !== CHAIN_ID;
  const pendingResume =
    saved && saved.contractAddress && !saved.configureTxHash && !saved.completedAt;

  const set = (patch: Partial<LaunchFormValues>) =>
    setForm((f) => ({ ...f, ...patch }));

  // Prefill payout with the connected wallet.
  useEffect(() => {
    if (isConnected && address && form.creatorPayoutAddress === "") {
      set({ creatorPayoutAddress: address });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  function openConfirm() {
    const { params, errors: errs } = deriveAndValidate(form, jwt, imageFile, saved);
    setErrors(errs);
    if (params && errs.length === 0) {
      setDerived(params);
      setConfirmChecked(false);
      setPhase("confirm");
    }
  }

  function updateStep(id: string, patch: Partial<StepView>) {
    setSteps((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function runLaunch(resume: boolean) {
    const base = resume ? loadLaunchState() : null;
    const { params, errors: errs } = deriveAndValidate(form, jwt, imageFile, base);
    setErrors(errs);
    if (!params || errs.length > 0) {
      setPhase("form");
      return;
    }
    if (!walletClient || !publicClient || !address) {
      setErrors(["Connect your wallet first"]);
      setPhase("form");
      return;
    }
    if (chainId !== CHAIN_ID) {
      setErrors(["Switch to Robinhood Chain first (button in the top bar)"]);
      setPhase("form");
      return;
    }

    // Resume reuses the frozen timestamps so the drop window doesn't drift.
    let st: LaunchState =
      resume && base
        ? base
        : {
            form,
            startTime: params.startTime,
            endTime: params.endTime,
          };
    if (!resume) saveLaunchState(st);
    setState(st);
    setRunError(null);
    setPhase("running");

    const stepList: StepView[] = [
      { id: "auth", label: "Verify Pinata JWT", status: "pending" },
      { id: "image", label: "Upload pre-reveal image to IPFS", status: "pending" },
      { id: "premeta", label: "Upload pre-reveal metadata to IPFS", status: "pending" },
      { id: "contracturi", label: "Upload collection metadata (contractURI)", status: "pending" },
      { id: "deploy", label: "TX 1/2 — deploy ERC721SeaDrop", status: "pending" },
      { id: "configure", label: "TX 2/2 — multiConfigure (supply, drop, payout)", status: "pending" },
      ...(params.royaltyBps
        ? [{ id: "royalty", label: `Optional TX — setRoyaltyInfo (${params.royaltyBps} bps)`, status: "pending" as const }]
        : []),
      ...(form.enforcedRoyalties
        ? [{ id: "validator", label: "Optional TX — setTransferValidator (enforced royalties)", status: "pending" as const }]
        : []),
    ];
    setSteps(stepList);

    const fail = (id: string, e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      updateStep(id, { status: "failed", detail: msg });
      setRunError(
        `${msg}\n\nProgress is saved — press LAUNCH again (or Resume) to retry from this step. Nothing already uploaded or deployed is redone.`,
      );
    };

    try {
      // ── Pinata ────────────────────────────────────────────────────────────
      updateStep("auth", { status: "running" });
      await testPinataJwt(jwt);
      updateStep("auth", { status: "done" });

      updateStep("image", { status: "running" });
      if (!st.prerevealImageCid) {
        if (!imageFile) throw new Error("Re-select the pre-reveal image to continue");
        const cid = await pinFile(jwt, imageFile, `${form.name} pre-reveal`, (p) =>
          updateStep("image", { progress: p }),
        );
        st = updateLaunchState({ prerevealImageCid: cid });
        setState(st);
      }
      updateStep("image", {
        status: "done",
        detail: <IpfsLink uri={`ipfs://${st.prerevealImageCid}`} />,
      });

      updateStep("premeta", { status: "running" });
      if (!st.prerevealMetadataCid) {
        // One shared unrevealed JSON for every token id: ERC721SeaDrop returns
        // baseURI verbatim for ALL ids when it does not end in "/" (verified in
        // the contract source) — no need for `supply` copies of the same file.
        const cid = await pinJson(
          jwt,
          {
            name: `${form.name} (unrevealed)`,
            description: form.description,
            image: `ipfs://${st.prerevealImageCid}`,
            ...(form.websiteUrl.trim()
              ? { external_url: form.websiteUrl.trim() }
              : {}),
          },
          `${form.name} pre-reveal metadata`,
        );
        st = updateLaunchState({ prerevealMetadataCid: cid });
        setState(st);
      }
      updateStep("premeta", {
        status: "done",
        detail: <IpfsLink uri={`ipfs://${st.prerevealMetadataCid}`} />,
      });

      updateStep("contracturi", { status: "running" });
      if (!st.contractUriCid) {
        // Contract-level metadata per OpenSea's spec; external_link is the
        // collection website. Socials (X/Discord) have no metadata field —
        // OpenSea only connects them via OAuth in collection settings.
        const cid = await pinJson(
          jwt,
          {
            name: form.name,
            description: form.description,
            image: `ipfs://${st.prerevealImageCid}`,
            ...(form.websiteUrl.trim()
              ? { external_link: form.websiteUrl.trim() }
              : {}),
          },
          `${form.name} contractURI`,
        );
        st = updateLaunchState({ contractUriCid: cid });
        setState(st);
      }
      updateStep("contracturi", {
        status: "done",
        detail: <IpfsLink uri={`ipfs://${st.contractUriCid}`} />,
      });

      // ── TX 1: deploy ─────────────────────────────────────────────────────
      updateStep("deploy", { status: "running", detail: "confirm in wallet…" });
      if (!st.contractAddress) {
        const hash = await walletClient.deployContract({
          abi: erc721SeaDropAbi,
          bytecode: erc721SeaDropBytecode,
          args: [form.name, form.symbol, [SEADROP_ADDRESS]],
          account: address,
          chain: robinhoodChain,
        });
        st = updateLaunchState({ deployTxHash: hash });
        setState(st);
        updateStep("deploy", { detail: "waiting for confirmation…" });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success" || !receipt.contractAddress) {
          throw new Error(`Deploy transaction reverted (${hash})`);
        }
        st = updateLaunchState({ contractAddress: receipt.contractAddress });
        setState(st);
      }
      updateStep("deploy", {
        status: "done",
        detail: <AddrLink address={st.contractAddress!} />,
      });

      // ── TX 2: multiConfigure ─────────────────────────────────────────────
      updateStep("configure", { status: "running", detail: "confirm in wallet…" });
      if (!st.configureTxHash) {
        const config = {
          maxSupply: BigInt(form.supply),
          // No trailing slash: same unrevealed JSON for every token until reveal.
          baseURI: `ipfs://${st.prerevealMetadataCid}`,
          contractURI: `ipfs://${st.contractUriCid}`,
          seaDropImpl: SEADROP_ADDRESS,
          publicDrop: {
            mintPrice: params.priceWei,
            startTime: st.startTime,
            endTime: st.endTime,
            maxTotalMintableByWallet: form.perWalletLimit,
            feeBps: OPENSEA_FEE_BPS,
            restrictFeeRecipients: true,
          },
          dropURI: "",
          allowListData: {
            merkleRoot: zeroHash,
            publicKeyURIs: [],
            allowListURI: "",
          },
          creatorPayoutAddress: params.payout,
          provenanceHash: params.provenance ?? zeroHash,
          allowedFeeRecipients: [OPENSEA_FEE_RECIPIENT],
          disallowedFeeRecipients: [],
          allowedPayers: [],
          disallowedPayers: [],
          // Public-only mint by design — every other stage stays empty.
          tokenGatedAllowedNftTokens: [],
          tokenGatedDropStages: [],
          disallowedTokenGatedAllowedNftTokens: [],
          signers: [],
          signedMintValidationParams: [],
          disallowedSigners: [],
        };
        const { request } = await publicClient.simulateContract({
          address: st.contractAddress as `0x${string}`,
          abi: erc721SeaDropAbi,
          functionName: "multiConfigure",
          args: [config],
          account: address,
        });
        const hash = await walletClient.writeContract(request);
        updateStep("configure", { detail: "waiting for confirmation…" });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error(`multiConfigure reverted (${hash})`);
        }
        st = updateLaunchState({ configureTxHash: hash });
        setState(st);
      }
      updateStep("configure", {
        status: "done",
        detail: <TxLink hash={st.configureTxHash!} />,
      });

      // ── Optional TX 3: royalties (ERC-2981) ──────────────────────────────
      if (params.royaltyBps) {
        updateStep("royalty", { status: "running", detail: "confirm in wallet…" });
        if (!st.royaltyTxHash) {
          const hash = await walletClient.writeContract({
            address: st.contractAddress as `0x${string}`,
            abi: tokenAbi,
            functionName: "setRoyaltyInfo",
            args: [{ royaltyAddress: params.payout, royaltyBps: BigInt(params.royaltyBps) }],
            account: address,
            chain: robinhoodChain,
          });
          updateStep("royalty", { detail: "waiting for confirmation…" });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            throw new Error(`setRoyaltyInfo reverted (${hash})`);
          }
          st = updateLaunchState({ royaltyTxHash: hash });
          setState(st);
        }
        updateStep("royalty", {
          status: "done",
          detail: <TxLink hash={st.royaltyTxHash!} />,
        });
      }

      // ── Optional TX 4: enforced royalties (OpenSea transfer validator) ───
      if (form.enforcedRoyalties) {
        updateStep("validator", { status: "running", detail: "confirm in wallet…" });
        if (!st.validatorTxHash) {
          const { request } = await publicClient.simulateContract({
            address: st.contractAddress as `0x${string}`,
            abi: tokenAbi,
            functionName: "setTransferValidator",
            args: [TRANSFER_VALIDATOR],
            account: address,
          });
          const hash = await walletClient.writeContract(request);
          updateStep("validator", { detail: "waiting for confirmation…" });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            throw new Error(`setTransferValidator reverted (${hash})`);
          }
          st = updateLaunchState({ validatorTxHash: hash });
          setState(st);
        }
        updateStep("validator", {
          status: "done",
          detail: <TxLink hash={st.validatorTxHash!} />,
        });
      }

      st = updateLaunchState({ completedAt: Date.now() });
      setState(st);
      setPhase("done");
    } catch (e) {
      // Mark the step that was running as failed; progress stays saved.
      setSteps((all) => {
        const firstActive = all.find((s) => s.status === "running");
        if (firstActive) fail(firstActive.id, e);
        else setRunError(e instanceof Error ? e.message : String(e));
        return all;
      });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (phase === "done" && state?.contractAddress) {
    return (
      <SuccessPanel
        state={state}
        onReset={() => {
          clearLaunchState();
          setState(null);
          setForm({ ...EMPTY_FORM, startLocal: nowPlusMinutesLocalInput(60) });
          setPhase("form");
        }}
      />
    );
  }

  return (
    <div>
      {pendingResume ? (
        <div className="panel">
          <h2>Unfinished launch detected</h2>
          <p>
            The contract deployed at{" "}
            <AddrLink address={saved!.contractAddress!} /> but configuration
            didn&apos;t finish. Paste your Pinata JWT below if any upload steps
            remain, then resume — completed steps are skipped.
          </p>
          <button className="primary" onClick={() => runLaunch(true)}>
            RESUME CONFIGURATION
          </button>{" "}
          <button
            className="danger"
            onClick={() => {
              clearLaunchState();
              window.location.reload();
            }}
          >
            discard saved launch
          </button>
        </div>
      ) : null}

      <div className="panel">
        <h2>Collection</h2>
        <div className="grid">
          <div className="field">
            <label>collection name</label>
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="My Collection"
            />
          </div>
          <div className="field">
            <label>symbol</label>
            <input
              value={form.symbol}
              onChange={(e) => set({ symbol: e.target.value.toUpperCase() })}
              placeholder="MYC"
            />
          </div>
          <div className="field wide">
            <label>description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
          <div className="field wide">
            <label>website (optional — shows on OpenSea as the collection link)</label>
            <input
              value={form.websiteUrl}
              onChange={(e) => set({ websiteUrl: e.target.value })}
              placeholder="https://…  (Twitter/X can't be set here — OpenSea connects it via OAuth in collection settings)"
            />
          </div>
          <div className="field">
            <label>number of NFTs (maxSupply)</label>
            <input
              type="number"
              min={1}
              value={form.supply || ""}
              onChange={(e) => set({ supply: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>pre-reveal image</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            />
            <span className="hint">
              shown for every token until you run the Reveal — the real art
              stays off IPFS until then
            </span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Public drop</h2>
        <div className="grid">
          <div className="field">
            <label>mint price (ETH — $ prices don&apos;t exist on-chain)</label>
            <input
              value={form.mintPriceEth}
              onChange={(e) => set({ mintPriceEth: e.target.value })}
              placeholder="0 for free mint"
            />
          </div>
          <div className="field">
            <label>per-wallet mint limit</label>
            <input
              type="number"
              min={1}
              value={form.perWalletLimit || ""}
              onChange={(e) => set({ perWalletLimit: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>start time (your local time)</label>
            <input
              type="datetime-local"
              value={form.startLocal}
              onChange={(e) => set({ startLocal: e.target.value })}
            />
            {form.startLocal ? (
              <span className="hint">
                = {safeUtc(form.startLocal)}
              </span>
            ) : null}
          </div>
          <div className="field">
            <label>end time (optional — default start + {DEFAULT_DROP_DAYS} days)</label>
            <input
              type="datetime-local"
              value={form.endLocal}
              onChange={(e) => set({ endLocal: e.target.value })}
            />
            {form.endLocal ? (
              <span className="hint">= {safeUtc(form.endLocal)}</span>
            ) : null}
          </div>
          <div className="field">
            <label>creator payout address (payouts stream here on every mint)</label>
            <input
              value={form.creatorPayoutAddress}
              onChange={(e) => set({ creatorPayoutAddress: e.target.value })}
              placeholder="0x…"
            />
          </div>
          <div className="field">
            <label>royalty % (optional, ERC-2981)</label>
            <input
              value={form.royaltyPercent}
              onChange={(e) => set({ royaltyPercent: e.target.value })}
              placeholder="e.g. 5 — leave empty to skip"
            />
          </div>
          <div className="field">
            <label>royalty enforcement</label>
            <select
              value={form.enforcedRoyalties ? "enforced" : "signal"}
              onChange={(e) =>
                set({ enforcedRoyalties: e.target.value === "enforced" })
              }
            >
              <option value="signal">
                signal only — marketplaces may ignore (default)
              </option>
              <option value="enforced">
                enforced — OpenSea transfer validator (+1 tx)
              </option>
            </select>
            <span className="hint">
              enforced = transfers restricted to royalty-respecting channels via{" "}
              {TRANSFER_VALIDATOR.slice(0, 10)}… — same validator live enforced
              drops on this chain use; owner can turn it off later
            </span>
          </div>
          <div className="field wide">
            <label>provenance hash (optional, 32-byte hex — set before mint as a trust signal)</label>
            <input
              value={form.provenanceHash}
              onChange={(e) => set({ provenanceHash: e.target.value })}
              placeholder="0x… (SHA-256 of your final art ordering)"
            />
          </div>
        </div>
        <p className="dim" style={{ marginBottom: 0 }}>
          OpenSea drop fee: {OPENSEA_FEE_BPS / 100}% to{" "}
          {OPENSEA_FEE_RECIPIENT.slice(0, 10)}… (required for OpenSea drops,
          restricted fee recipients on). Allowlist / signed / token-gated stages
          are intentionally not supported — public mint only. Mint currency is
          native ETH only: the canonical SeaDrop contract hard-codes msg.value
          payment, so ERC-20 pricing (USDG/WETH) would need a custom contract
          that OpenSea&apos;s drop indexing doesn&apos;t recognize.
        </p>
      </div>

      <div className="panel">
        <h2>Pinata</h2>
        <div className="field">
          <label>Pinata JWT (kept in memory only — never stored, re-paste each session)</label>
          <input
            type="password"
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
            placeholder="eyJ…"
            autoComplete="off"
          />
        </div>
      </div>

      {errors.length > 0 ? (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      {phase === "running" ? (
        <div className="panel">
          <h2>Launching</h2>
          <Steps steps={steps} />
          {runError ? (
            <>
              <p className="error">{runError}</p>
              <button className="primary" onClick={() => runLaunch(true)}>
                RETRY FROM FAILED STEP
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <button
          className="primary"
          style={{ width: "100%", padding: "16px" }}
          disabled={!isConnected || wrongNetwork}
          onClick={openConfirm}
        >
          {!isConnected
            ? "CONNECT WALLET TO LAUNCH"
            : wrongNetwork
              ? "SWITCH TO ROBINHOOD CHAIN TO LAUNCH"
              : "LAUNCH"}
        </button>
      )}

      {phase === "confirm" && derived ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Confirm launch — read every line</h3>
            <dl>
              <dt>collection</dt>
              <dd>
                {form.name} ({form.symbol})
              </dd>
              <dt>supply</dt>
              <dd>{form.supply.toLocaleString()} NFTs</dd>
              <dt>price</dt>
              <dd>
                {derived.priceWei === 0n
                  ? "FREE (0 ETH)"
                  : `${weiToEth(derived.priceWei)} ETH each`}
              </dd>
              <dt>per wallet</dt>
              <dd>max {form.perWalletLimit} mints</dd>
              <dt>starts</dt>
              <dd>
                {unixToLocalAndUtc(derived.startTime).local}
                <br />
                {unixToLocalAndUtc(derived.startTime).utc}
              </dd>
              <dt>ends</dt>
              <dd>
                {unixToLocalAndUtc(derived.endTime).local}
                <br />
                {unixToLocalAndUtc(derived.endTime).utc}
                {form.endLocal ? "" : ` (default: start + ${DEFAULT_DROP_DAYS} days)`}
              </dd>
              <dt>payout to</dt>
              <dd>{derived.payout}</dd>
              <dt>OpenSea fee</dt>
              <dd>{OPENSEA_FEE_BPS / 100}% of mint price</dd>
              <dt>royalties</dt>
              <dd>
                {derived.royaltyBps
                  ? `${derived.royaltyBps / 100}% to ${derived.payout.slice(0, 10)}… — ${
                      form.enforcedRoyalties
                        ? "ENFORCED via OpenSea transfer validator"
                        : "signal only (ERC-2981, marketplaces may ignore)"
                    }`
                  : "none (can set later in OpenSea collection settings)"}
              </dd>
              <dt>website</dt>
              <dd>{form.websiteUrl.trim() || "not set"}</dd>
              <dt>provenance</dt>
              <dd>{derived.provenance ?? "not set"}</dd>
              <dt>predicted link</dt>
              <dd>{openSeaCollectionUrl("<contract-address>")}</dd>
            </dl>
            <p className="warn">
              Name and symbol are permanent. Price, start/end time and
              per-wallet limit CAN be changed later by the owner via
              updatePublicDrop (Status tab). maxSupply can only be reduced,
              never below what&apos;s already minted.
            </p>
            <p>
              You will sign{" "}
              {2 + (derived.royaltyBps ? 1 : 0) + (form.enforcedRoyalties ? 1 : 0)}{" "}
              transactions: deploy, multiConfigure
              {derived.royaltyBps ? ", setRoyaltyInfo" : ""}
              {form.enforcedRoyalties ? ", setTransferValidator" : ""}.
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
              />
              I checked every parameter above
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                className="primary"
                disabled={!confirmChecked}
                onClick={() => runLaunch(false)}
              >
                SIGN &amp; LAUNCH
              </button>
              <button className="secondary" onClick={() => setPhase("form")}>
                back
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function safeUtc(local: string): string {
  try {
    return unixToLocalAndUtc(datetimeLocalToUnix(local)).utc;
  } catch {
    return "invalid date";
  }
}
