import { defineChain } from "viem";

/**
 * ── Robinhood Chain (mainnet) ─────────────────────────────────────────────────
 * Verified 2026-08-18 against:
 *   - chainlist.org/chain/4663
 *   - https://docs.robinhood.com/chain/connecting (official docs)
 * The public RPC below is rate-limited and fine for a creator tool. If it ever
 * struggles, swap RPC_URL for an Alchemy endpoint:
 *   https://robinhood-mainnet.g.alchemy.com/v2/<API_KEY>
 * (that is the only line you need to change).
 */
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";
export const CHAIN_ID = 4663;

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: EXPLORER_URL },
  },
});

/**
 * ── SeaDrop ──────────────────────────────────────────────────────────────────
 * Canonical SeaDrop 1.0, same deterministic address on every chain it exists on.
 * Verified on Robinhood Chain Blockscout 2026-08-18: contract is deployed,
 * source-verified, named "SeaDrop", created via the keyless CREATE2 deployer.
 * https://robinhoodchain.blockscout.com/address/0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
 */
export const SEADROP_ADDRESS =
  "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5" as const;

/**
 * ── Launch fee factory (monetization) ────────────────────────────────────────
 * PaidSeaDropCloneFactory — deploy it ONCE with your wallet (see README), then
 * paste its address here. While empty, LaunchPad falls back to a free direct
 * deploy (good for local/self-host). When set, every launch routes through the
 * factory and pays the on-chain launch fee to your fee recipient.
 *
 * The fee amount is read live from the factory (`launchFee()`), so change it
 * on-chain (setLaunchFee) without touching this file.
 */
export const LAUNCH_FACTORY = "" as string;

/**
 * ── OpenSea drop fee ─────────────────────────────────────────────────────────
 * OpenSea's standard SeaDrop fee recipient and primary-sale fee.
 * Verified 2026-08-18 by decoding live drops on Robinhood Chain's SeaDrop:
 * every recent collection allows fee recipient 0x0000a26b…fAa719 and uses
 * feeBps = 1000 (10%) with restrictFeeRecipients = true.
 * If OpenSea changes this, update these two constants (check
 * https://docs.opensea.io/docs/deploying-a-seadrop-compatible-contract).
 */
export const OPENSEA_FEE_RECIPIENT =
  "0x0000a26b00c1F0DF003000390027140000fAa719" as const;
export const OPENSEA_FEE_BPS = 1000;

/**
 * ── Royalty enforcement ──────────────────────────────────────────────────────
 * OpenSea's transfer validator (StrictAuthorizedTransferSecurityRegistry,
 * source-verified on Robinhood Chain Blockscout). Setting it via
 * setTransferValidator makes royalties ENFORCED — transfers are restricted to
 * authorized (royalty-respecting) channels. Verified 2026-08-19: live enforced
 * drops on this chain use exactly this address; non-enforced ones keep 0x0.
 */
export const TRANSFER_VALIDATOR =
  "0xA000027A9B2802E1ddf7000061001e5c005A0000" as const;

/**
 * ── Profit data sources ──────────────────────────────────────────────────────
 * Seaport 1.6 (canonical cross-chain address, deployed on Robinhood Chain) —
 * OpenSea secondary sales pay creator royalties as internal transfers from it.
 * Blockscout v2 API allows browser CORS (verified) and provides internal
 * transactions + coin price.
 */
export const SEAPORT_1_6 =
  "0x0000000000000068F116a894984e2DB1123eB395" as const;
export const BLOCKSCOUT_API = `${EXPLORER_URL}/api/v2`;

/**
 * ── OpenSea links ────────────────────────────────────────────────────────────
 * OpenSea's chain slug for Robinhood Chain (see
 * https://opensea.io/collections/chain/robinhood).
 */
export const OPENSEA_CHAIN_SLUG = "robinhood";

export function openSeaCollectionUrl(contract: string): string {
  return `https://opensea.io/assets/${OPENSEA_CHAIN_SLUG}/${contract}`;
}

export function openSeaItemUrl(contract: string, tokenId: string | number | bigint): string {
  return `https://opensea.io/item/${OPENSEA_CHAIN_SLUG}/${contract}/${tokenId}`;
}

/**
 * Prefilled X (Twitter) post composer. Nothing is auto-posted — the user
 * reviews and edits in X's own UI. The actual "Connect X" for a collection is
 * an OAuth flow that exists only inside opensea.io settings.
 */
export function xShareUrl(text: string, url: string): string {
  const params = new URLSearchParams({ text, url });
  return `https://x.com/intent/post?${params.toString()}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

/** Pinata public gateway, used only for "check what you uploaded" links. */
export function ipfsGatewayUrl(ipfsUri: string): string {
  return `https://gateway.pinata.cloud/ipfs/${ipfsUri.replace("ipfs://", "")}`;
}

/** Default public-drop window length when no end time is given. */
export const DEFAULT_DROP_DAYS = 30;
