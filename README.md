# LaunchPad — one-click NFT drop launcher for Robinhood Chain

A single-page static web app for launching a complete, OpenSea-indexed NFT drop
on **Robinhood Chain** in one sitting: fill a form, upload a pre-reveal image,
connect your wallet, press **LAUNCH**, sign 2 transactions — done. The
collection is deployed, configured, mintable, and picked up by OpenSea
automatically because the contract is the stock **ERC721SeaDrop** talking to the
canonical **SeaDrop** contract that OpenSea natively understands.

This is a creator tool for launching **your own** collections from **your own**
connected wallet:

- **No private keys, ever.** All signing happens in your injected wallet
  (MetaMask/Rabby) via wagmi/viem. The only secrets you touch are your wallet
  (in the extension) and your Pinata JWT (pasted per session, held in memory
  only, never persisted).
- **No minting-bot features.** No wallet generation, no multi-wallet minting,
  no auto-listing. Public mint stage only — allowlist/signed/token-gated stages
  are intentionally not built.
- The deployed contract's `owner` is your connected wallet. The app holds zero
  privileges.

## Architecture (facts verified 2026-08-18)

- OpenSea Studio has **no public API** for creating drops — Studio is UI-only.
  LaunchPad bypasses it: the on-chain half (contract, supply, price, window,
  per-wallet limit, payouts, fees) is fully automated via SeaDrop; only the
  cosmetic drop page on opensea.io requires manual clicks afterwards (the app
  prints that checklist on the success screen).
- **Robinhood Chain**: chain id **4663**, Arbitrum Orbit, native ETH.
  Public RPC `https://rpc.mainnet.chain.robinhood.com`, explorer
  `https://robinhoodchain.blockscout.com` (both from the official Robinhood
  docs; also on chainlist.org/chain/4663). Swap the RPC in
  [`src/config.ts`](src/config.ts) if you have an Alchemy key.
- **SeaDrop** is deployed and source-verified on Robinhood Chain at the
  canonical cross-chain address
  [`0x00005EA00Ac477B1030CE78506496e8C2dE24bf5`](https://robinhoodchain.blockscout.com/address/0x00005EA00Ac477B1030CE78506496e8C2dE24bf5).
- **OpenSea drop fee**: every live SeaDrop collection on Robinhood Chain allows
  fee recipient `0x0000a26b00c1F0DF003000390027140000fAa719` with
  `feeBps = 1000` (10%) and `restrictFeeRecipients = true` (verified by decoding
  the SeaDrop contract's live state). LaunchPad configures the same. Constants
  live in `src/config.ts`.
- **OpenSea chain slug**: `robinhood` → collections appear at
  `https://opensea.io/assets/robinhood/<contract>`.

### The embedded contract

`src/contracts/ERC721SeaDrop.json` is the **stock, unmodified**
`ERC721SeaDrop` from [ProjectOpenSea/seadrop](https://github.com/ProjectOpenSea/seadrop)
(`src/ERC721SeaDrop.sol`, commit `6ab8b2c`), compiled with the repo's own pinned
settings (solc 0.8.17, optimizer 1,000,000 runs, `bytecode_hash = "none"`).
Mint logic untouched — OpenSea compatibility depends on it. To regenerate:

```bash
git clone https://github.com/ProjectOpenSea/seadrop && cd seadrop
git submodule update --init lib/ERC721A lib/solmate lib/openzeppelin-contracts lib/utility-contracts
forge build src/ERC721SeaDrop.sol
# then copy abi + bytecode.object from out/ERC721SeaDrop.sol/ERC721SeaDrop.json
```

Two contract behaviors LaunchPad relies on (verified in that source, don't
"fix" them):

1. `tokenURI(id)`: if `baseURI` does **not** end in `/`, the contract returns
   `baseURI` verbatim for **every** token → pre-reveal uses ONE shared
   unrevealed JSON, not N copies. If it **does** end in `/`, it returns
   `baseURI + tokenId` with **no `.json` suffix** → revealed metadata files are
   named `1`, `2`, … with no extension.
2. `setBaseURI` emits `BatchMetadataUpdate(1, totalMinted)` — OpenSea refreshes
   metadata on its own after the reveal.

## Run it

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (CSV converter, wei/time conversions)
npm run build      # typecheck + production build into dist/
```

Deploy anywhere static (no backend, no database):

- **Cloudflare Pages** (config included — `wrangler.toml`):
  - *Git-connected (recommended)*: Cloudflare dashboard → Workers & Pages →
    Create → Pages → Connect to Git → pick this repo, build command
    `npm run build`, output `dist` (both are auto-detected from
    `wrangler.toml`). Every push redeploys automatically.
  - *CLI*: `CLOUDFLARE_API_TOKEN=<token> npm run deploy:cf`
    (token: Cloudflare dashboard → My Profile → API Tokens → template
    "Edit Cloudflare Workers"/Pages edit). First run creates the `launchpad`
    Pages project and prints the `*.pages.dev` URL.
- **Vercel**: `vercel` in the repo root — framework preset "Vite", build
  command `npm run build`, output `dist`. Or just import the repo in the Vercel
  dashboard.
- **Netlify**: build `npm run build`, publish directory `dist`.

## Launch flow (what the one button does)

1. Validates everything, then shows a confirmation modal with every parameter
   in plain language (price in ETH — $ prices don't exist on-chain; start/end
   shown in your local timezone AND UTC). Requires a checkbox.
2. Uploads to Pinata: pre-reveal image → one shared unrevealed metadata JSON →
   collection-level `contractURI` JSON. Per-step progress, each CID linked.
3. **TX 1**: deploy `ERC721SeaDrop(name, symbol, [SeaDrop])`.
   **TX 2**: `multiConfigure(...)` — maxSupply, baseURI (pre-reveal),
   contractURI, public drop (price/window/per-wallet limit/fee), creator payout
   address, optional provenance hash, OpenSea fee recipient allowed.
   Optional **TX 3**: `setRoyaltyInfo` if you set a royalty % (ERC-2981 —
   supported by this contract but not part of `multiConfigure`).
   Optional **TX 4**: `setTransferValidator` when royalty enforcement is set to
   "enforced" — it points the token at OpenSea's transfer validator
   (`StrictAuthorizedTransferSecurityRegistry`,
   `0xA000027A9B2802E1ddf7000061001e5c005A0000`, source-verified; the same
   validator live enforced drops on Robinhood Chain use). "Signal only" leaves
   the validator unset — ERC-2981 is then a request marketplaces may ignore.
   The owner can flip enforcement on/off later from the Status tab.
4. Success screen: contract address, Blockscout + predicted OpenSea links, mint
   countdown, and the manual OpenSea Studio checklist.

Every step is persisted to `localStorage`. If configure fails after deploy
succeeded, the Launch tab offers **Resume** — completed steps (uploads, deploy)
are never redone, and the drop window doesn't drift because the original
timestamps are frozen in the saved state.

## Reveal flow

The real art must **not** touch IPFS until reveal — otherwise snipers scrape
rarities before mint-out. Launch uploads only the pre-reveal assets. When ready:

1. Reveal tab → contract is prefilled from the saved launch (or paste it).
2. Pick the images folder (`1.png … N.png`) and optionally your **OpenSea
   Studio CSV** (`tokenID,name,description,file_name,external_url,attributes[Type],…`).
   Empty attribute cells are skipped; plain-number values become numeric
   traits. No CSV → minimal `"<Collection> #N"` metadata is generated.
3. The app refuses with a precise diff if anything disagrees: image count vs
   on-chain `maxSupply`, ids not consecutive from 1, duplicate ids, CSV rows
   missing/extra, `file_name`s that don't match uploaded files.
4. Upload images folder → build per-token JSONs (named `1…N`, no extension) →
   upload metadata folder → **one tx**: `setBaseURI("ipfs://<metadataCID>/")`
   (trailing slash required). `BatchMetadataUpdate` is emitted; OpenSea
   refreshes on its own. If an item lags: item page → … → Refresh metadata.

## Networks (multi-chain)

LaunchPad works on every OpenSea-supported EVM mainnet where the canonical
SeaDrop is deployed — verified on-chain (`eth_getCode`), not from docs. Pick one
in the top-bar **network selector**; it drives both wallet mode (asks the wallet
to switch) and fast mode (the local signer targets that chain).

Supported: Robinhood Chain, Ethereum, Base, Arbitrum One, Arbitrum Nova,
Optimism, Polygon, Zora, Blast, Avalanche, Sei, B3, Ronin, ApeChain, Shape,
Soneium, Unichain, Abstract, Berachain, Flow EVM. (Solana is non-EVM and out of
scope.) SeaDrop, Seaport 1.6, the OpenSea fee recipient, and the royalty
transfer validator are the same deterministic addresses on all of them — the
registry with per-chain RPC, explorer, and OpenSea slug is `src/chains.ts`.

Per-chain notes:

- **Enforced royalties** need the transfer validator, which is deployed
  everywhere *except Abstract* — the enforce option hides itself there.
- **The launch fee factory is per chain.** Deploy one per chain you want to
  monetize and map it in `LAUNCH_FACTORIES` (`src/config.ts`).
- **Profit / Dashboard richness depends on the chain's explorer.** Mint revenue
  comes from RPC logs and works wherever the chain's RPC serves full-range
  `getLogs`; royalties and USD need a Blockscout v2 API, set for the chains that
  have one (Robinhood, Base, Optimism, Zora, B3, Shape, Soneium, Unichain, Flow).
  Where a public RPC caps log range (some do), the profit panel says so — swap
  that chain's RPC in `chains.ts` for an archive-capable one to fix it.

## Charging a launch fee (monetization)

LaunchPad can take a flat on-chain fee for every launch — no backend, no
accounts, no stored data. You deploy a small factory contract once; from then
on every launch routes through it and pays the fee to your wallet in the same
transaction as the deploy.

- **Off by default.** While `LAUNCH_FACTORY` in `src/config.ts` is empty,
  launches are a free direct deploy (local/self-host).
- **To turn it on**, deploy `contracts/PaidSeaDropCloneFactory.sol` (full
  build/deploy/manage steps and an honesty note on what a fee can and can't
  enforce are in [`contracts/README.md`](contracts/README.md)), paste its
  address into `LAUNCH_FACTORY`, and redeploy the site.
- The fee amount is read live from the factory (`launchFee()`) and is
  owner-settable on-chain, so you change pricing without touching code.
- The factory deploys OpenSea `ERC721SeaDropCloneable` clones — real,
  OpenSea-compatible SeaDrop collections owned by the creator. Verified against
  the live SeaDrop with a fork test.

Accounts / fiat subscriptions are a possible later phase (they need a real
backend, database, auth, and Stripe — i.e. running a money-handling business);
the on-chain fee covers "charge per launch" with none of that.

## Signing: browser wallet vs. fast mode

Two ways to sign, chosen with the **wallet | fast ⚡** toggle in the top bar:

- **wallet** (default): your injected wallet (MetaMask/Rabby). Every transaction
  shows a confirmation pop-up. Nothing sensitive touches the app.
- **fast ⚡** (local signer): paste **one** private key; transactions then sign
  automatically with **no pop-up** — the same convenience a deploy script has.
  The key is held in the browser tab's memory only: never written to
  localStorage, never sent over the network (viem signs locally and broadcasts
  the already-signed transaction), and gone the moment you refresh.

Fast mode is a deliberate footgun with rails. It is **single-key by design**
(no wallet list, no generation, no multi-account — that stays out on purpose).
The real risk is exposure: anything that can run script in the page — a browser
extension, a compromised dependency, an XSS bug — can read a key while it's
loaded. So for real funds:

- Run LaunchPad **locally** (`npm run dev` on your own machine), not the public
  URL, when a key is loaded.
- Use a wallet that holds only what the session needs, and remove the key
  (top bar → **remove key**) when done.

There is no server and no key database anywhere in this project — a backend that
stored keys would concentrate every wallet behind one breachable door, which is
strictly worse than one key in one browser tab.

## Dashboard tab

All your projects in one place. Launches made from this browser register
themselves; any other collection can be tracked by pasting its address or an
OpenSea/Blockscout link (the registry is addresses-only, stored locally).

- **Total profit** across projects with a **live cumulative chart** (crosshair
  tooltip, auto-refresh every 30s) built from real events: mint proceeds at
  their block times, royalty payouts at their tx times, launch gas at deploy
  time. Royalty payouts are deduped when collections share a receiver wallet.
- **Table**: collection, minted/supply, volume≈ (secondary volume derived from
  royalty payouts — needs royalties > 0), deployer, profit (green/red), date.
  Click a column header to sort; "only mine" filters to collections owned by
  the connected wallet. Click a row to expand the full Status-style detail.

## Mint tab

Quick manual public mint — one wallet, one click, the same `mintPublic` call
the drop page makes. Paste a collection address or OpenSea link, see the drop
state (price, countdown, per-wallet limit), pick a quantity, sign. Minted token
ids come back with direct OpenSea item links; listing happens on the item
page's **Sell** button (first listing asks for a one-time approval in your
wallet). There is deliberately no automation, no sniping, no multi-wallet, and
no in-app listing — OpenSea's order book API needs an API key and a backend,
and LaunchPad has neither.

## Status tab

Read-only dashboard for any pasted/saved contract: minted vs maxSupply, decoded
`PublicDrop` (price, window in local+UTC, per-wallet limit, fee), owner, payout
address, baseURI (revealed or not), provenance, OpenSea/Blockscout links.

**Profit widget** — a big green/red number:
`profit = mint proceeds + royalties − launch cost`.

- *Mint proceeds* are exact: decoded from SeaDrop's `SeaDropMint` events for
  this contract, already net of OpenSea's drop fee (the gross and OpenSea's
  cut are shown alongside).
- *Royalties* are an estimate: the sum of Seaport 1.6 → royalty-receiver
  internal transfers (that's how OpenSea pays creator earnings on secondary
  sales). Other collections or the wallet's own OpenSea sales inflate it.
- *Launch cost* is the gas actually paid for the deploy (from the contract's
  creation tx) plus configure/royalty/reveal txs when the launch was made from
  this browser (saved state).

Owner actions (only shown to the owner):

- `updatePublicDrop` — change price / start / end / per-wallet limit any time.
- `setMaxSupply` — cut supply after mint slows (never below already-minted).
- Enforce / un-enforce royalties — one tx toggling OpenSea's transfer validator.
- Nothing to withdraw: mint proceeds stream to the creator payout address on
  every mint, automatically, via SeaDrop.

## Rehearsal script — run this before EVERY real launch

Gas on Robinhood Chain is near-zero; a full dress rehearsal costs pennies.

1. Prepare a throwaway set: 5 images (`1.png … 5.png`), optionally a 5-row CSV,
   any pre-reveal image.
2. Open LaunchPad with your deployer wallet on Robinhood Chain. Launch a
   collection named `REHEARSAL-<date>`, supply **5**, price **0**, per-wallet
   limit 5, start time **~2 minutes from now**.
3. Sign both transactions. Confirm the success screen shows the contract on
   Blockscout and the countdown reaches "live now".
4. From a **second browser profile / second wallet**, mint 1 via the contract
   on Blockscout: open the **SeaDrop** contract
   (`0x00005EA0…24bf5`) → Write → `mintPublic(nftContract, feeRecipient,
   minterIfNotPayer, quantity)` with your collection address,
   `0x0000a26b00c1F0DF003000390027140000fAa719`, `0x0000…0000`, `1`.
5. Status tab: confirm minted = 1 and the drop params decode correctly.
6. Run the Reveal flow with the 5 real images (+ CSV). Confirm the tx succeeds
   and `baseURI` flips to `ipfs://…/` (revealed).
7. On opensea.io, find the collection (search the contract address), confirm
   metadata + images render, and traits show up. Force "Refresh metadata" on
   one item if needed.
8. Optional: `setMaxSupply(1)` from the Status tab to close the rehearsal
   collection down to the single minted token.

If any step surprises you, fix the inputs and rehearse again before launching
the real collection.

## Verify the contract on Blockscout (buyer trust)

Verified source on the explorer builds buyer trust. From a clone of the seadrop
repo (same commit + submodules as above, so compiler settings match):

```bash
forge verify-contract \
  --verifier blockscout \
  --verifier-url https://robinhoodchain.blockscout.com/api/ \
  --compiler-version 0.8.17 \
  --constructor-args $(cast abi-encode "constructor(string,string,address[])" \
      "<Your Collection Name>" "<SYMBOL>" "[0x00005EA00Ac477B1030CE78506496e8C2dE24bf5]") \
  <YOUR_CONTRACT_ADDRESS> \
  src/ERC721SeaDrop.sol:ERC721SeaDrop
```

## Manual OpenSea Studio checklist (cannot be automated — no API)

1. Log into opensea.io with the **deployer wallet**.
2. The collection auto-appears after indexing (SeaDrop events; no submission).
3. Collection → Edit: logo, banner, description, royalties (if you didn't set
   ERC-2981 at launch). The website is already set if you filled it in at
   launch — it ships in the contractURI JSON as `external_link`.
4. Collection → Edit → Links: connect **X (Twitter)** and Discord. This is an
   OAuth flow that exists only in OpenSea's settings UI — there is no metadata
   field or API for it, so it cannot be automated.
5. Collection → Edit: switch the collection's **trading currency** from USDG
   (the Robinhood Chain default) to **ETH** if you want secondary listings and
   the floor denominated in ETH. Off-chain OpenSea marketplace preference —
   no contract field or public API exists for it, so it's a manual toggle.
   (Either way the primary mint settles in native ETH via SeaDrop, and buyers
   can still pay with other tokens — OpenSea swaps at checkout.)
6. Optional: OpenSea Studio drop-page cosmetics (gallery, story sections).
7. Post-reveal, if an item shows the placeholder: … → Refresh metadata.

## FAQ

**Why 2 signatures?** TX 1 deploys the contract (constructor can't configure
the drop — SeaDrop only accepts configuration from the deployed token itself).
TX 2 is `multiConfigure`, which batches *all* drop parameters into one call.
That's the minimum SeaDrop allows. (A royalty % adds an optional third —
`setRoyaltyInfo` isn't part of `multiConfigure`.)

**Why does the real art upload only at reveal?** IPFS is public. If the full
metadata directory exists before mint-out, anyone can scrape rarities and
snipe the best tokens. Pre-reveal, every token points at one shared
"unrevealed" JSON; `setBaseURI` at reveal flips the whole collection at once.

**How do I change the price/time/limit later?** Status tab → Owner actions →
`updatePublicDrop`. Owner-only, effective immediately, one transaction.

**Can the mint be priced in USDG or WETH?** No — and that's the canonical
SeaDrop contract, not this app: `mintPublic` is `payable` and validates
`msg.value == quantity × mintPrice`, paying out with native-ETH transfers.
ERC-20 pricing would require a custom drop contract that OpenSea's drop
indexing doesn't recognize, which defeats the point of LaunchPad. Buyers can
still pay with other tokens on OpenSea's *secondary* market (OpenSea swaps for
them); the primary mint settles in native ETH.

**Enforced vs signal-only royalties?** ERC-2981 (`setRoyaltyInfo`) is just an
on-chain request — marketplaces may ignore it. "Enforced" additionally sets
OpenSea's transfer validator, which restricts transfers to royalty-respecting
channels. Trade-off: enforcement limits composability (some marketplaces and
protocols won't be able to move the tokens), which is exactly the point.

**Can I raise the supply later?** `setMaxSupply` technically allows any value
not below the minted count, but treat supply as a promise to buyers — LaunchPad
surfaces it for *cutting* supply after mint slows.

**Why are metadata files named `1` and not `1.json`?** `ERC721SeaDrop.tokenURI`
returns `baseURI + tokenId` with no suffix. Files must match or every token 404s.

**Why does my wallet ask to "add network"?** First contact with Robinhood
Chain: the app offers chain id 4663 with the official RPC/explorer via your
wallet's add-chain prompt. One click, then switch.

**Where do mint proceeds go?** They stream to the creator payout address on
every mint (SeaDrop splits fee vs. payout in the mint transaction). There is no
withdraw step and no funds ever sit in the app.
