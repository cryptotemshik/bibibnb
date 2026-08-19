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
 * ── OpenSea links ────────────────────────────────────────────────────────────
 * OpenSea's chain slug for Robinhood Chain (see
 * https://opensea.io/collections/chain/robinhood).
 */
export const OPENSEA_CHAIN_SLUG = "robinhood";

export function openSeaCollectionUrl(contract: string): string {
  return `https://opensea.io/assets/${OPENSEA_CHAIN_SLUG}/${contract}`;
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
