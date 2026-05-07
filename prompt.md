# One-shot build prompt (copy everything below the line)

---

You are implementing a **Stellar Machine Payments Protocol (MPP) demo** end-to-end: an Express API on Stellar **Testnet** that protects routes with **HTTP 402** + MPP, plus a static **`public/` SPA-style page** that exercises every flow without putting secrets in the browser. The reference behavior matches the **`stellar-mpp-demo`** project conceptually: protocol lab for teaching charge pull, charge push, Soroban channel vouchers, and paid MCP tools using in-memory MCP transports.

## Hard requirements

- **Runtime:** Node **20+**, **ES modules** (`"type": "module"` in `package.json`).
- **Server:** Express **5**, `express.json()`, static files from `public/`.
- **MPP:**
  - `@stellar/mpp` for charge server/client and channel server/client.
  - `mppx` for `payment` middleware from **`mppx/express`**, MCP SDK integration (`mppx/mcp-sdk/client`, `mppx/server`), and **Store** semantics matching `mppx` (JSON round-trip in memory).
- **Stellar:** `@stellar/stellar-sdk` for Horizon + general helpers.
- **MCP:** `@modelcontextprotocol/sdk` — create an **in-process MCP server** and client connected with **`InMemoryTransport.createLinkedPair()`** (no network MCP).
- **Validation:** `zod` (v4 import style acceptable: `zod/v4`).
- **Config:** `dotenv` via `import "dotenv/config"` in a dedicated `src/config.js` that reads `example.env`-style variables (see below).

## Dependencies (approximate versions)

- `@modelcontextprotocol/sdk` ^1.29
- `@stellar/mpp` ^0.5
- `@stellar/stellar-sdk` ^15
- `dotenv` ^17
- `express` ^5
- `mppx` ^0.4
- `zod` ^4
- Dev: `eslint` + `@eslint/js` with `src/**/*.js` and `public/**/*.js` globals (Node + browser `document`, `fetch`, `console`).

## Environment variables (`example.env`)

Document and implement:

- **Server:** `PORT` (default **3002**), `MPP_SECRET_KEY` (required), `MPP_REALM` (default `localhost:PORT`), `MPP_PRICE` (human units string, default `0.00001`).
- **Stellar:** `STELLAR_NETWORK` (e.g. `stellar:testnet`), `STELLAR_RPC_URL`, `STELLAR_HORIZON_URL`, `STELLAR_RECIPIENT` (seller pubkey, required), `STELLAR_RECIPIENT_SECRET` (for channel fee payer / optional ops), `STELLAR_TOKEN_CONTRACT` (default Testnet **XLM SAC** `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`), `STELLAR_TOKEN_LABEL`, `STELLAR_TOKEN_DECIMALS` (7 for XLM).
- **Optional fee sponsor (pull charge):** `FEE_PAYER_SECRET`.
- **Channel:** `CHANNEL_CONTRACT`, `COMMITMENT_SECRET` (32-byte hex seed for ed25519), `COMMITMENT_PUBKEY` (hex pubkey optional if derived from secret in code), `CHANNEL_DEPOSIT` (string, for UX copy only if needed).
- **Demo client (server-side signing for browser demos):** `STELLAR_SECRET_KEY` (buyer), `API_BASE_URL` (default `http://localhost:3002`).

Do **not** commit real secrets; ship `example.env` only.

## MPP store architecture (important)

- Replace raw `Store.memory()` with a small helper **`src/clearable-mpp-store.js`** that mirrors `mppx`’s in-memory store (JSON via `ox`’s `Json` like mppx does) but exposes **`clear()`** on a shared `Map`.
- Use **separate** clearable instances for: **charge MPPx**, **push MPPx**, **HTTP channel** server store, **MCP channel server store**, **MCP channel client store**.
- Expose **`POST /api/demo/clear-mpp-stores`** that clears **all** of the above plus any exported `clearMcpDemoStores()` from `mcp-demo.js`. Return JSON `{ ok: true, message: "..." }`.

## HTTP API (implement in `src/server.js`)

1. **`GET /api/status`** — JSON: app name, route map, price, network, feature flags (charge pull/push, fee sponsored, channel configured).
2. **`GET /api/free-insight`** — free JSON (no payment).
3. **`GET /api/paid-insight`** — `payment(mppx.charge, { amount, description, meta })` then JSON body with `paid: true`, insight text, `nextStep`, `price`.
4. **`GET /api/paid-insight-push`** — separate `Mppx` instance **without** fee payer on stellar method; push charge + JSON with `mode: "push"`.
5. **`POST /api/demo-pay`** — body `{ mode: "pull" | "push" }`; calls shared client helper (`mpp-client.js`) to pay `"/api/paid-insight"` or `"/api/paid-insight-push"`, returns result + `events` log.
6. **`GET /api/wallets`** — describe roles: **buyer** (from `STELLAR_SECRET_KEY`), **seller/recipient**, optional **fee payer**, **commitment** (pubkey short + purpose). Include token label, contract, `requestPrice`, network, horizon URL.
7. Optional **`POST /api/wallets/fund`** — proxy Testnet Friendbot fund for a role if you want parity (only if reference implements it).
8. **Channel:** `GET /api/channel/state`, **`POST /api/channel/open`** (or inspect-only note if channel is pre-opened), `POST /api/channel/request` (voucher flow via `mpp-channel-client.js`), `POST /api/channel/close`, **`POST /api/channel/reset`** — return **410** if on-chain-only demo (no local reset).
9. **`GET /api/channel-paid-insight`** — if channel configured: `payment(channelMppx.channel, {...})`; else **503** with message to set env vars.
10. **MCP HTTP:** `GET /api/mcp/tools`; `POST /api/mcp/free`; `POST /api/mcp/charge` (body: `mode` pull/push, `toolName`, `arguments`); `POST /api/mcp/channel`; `POST /api/mcp/channel/session` (returns active + live `getChannelState` summary); `POST /api/mcp/no-payment` for dry-run errors.
11. **`POST /api/demo/clear-mpp-stores`** as above.

**Local server:** only `app.listen` when **not** `process.env.VERCEL` (Vercel uses serverless export).

## In-process MCP demo (`src/mcp-demo.js`)

- Define tools (Zod `inputSchema`):

  | name | paid | behavior |
  |------|------|------------|
  | `get_network_status` | no | RPC ping + network metadata |
  | `lookup_account` | no | Horizon load account; optional `account` (G…) else buyer |
  | `analyze_account_risk` | yes | Risk checks vs target + seller + channel snapshot |
  | `explain_latest_transactions` | yes | Recent txs for account with human explanations |

- **`_meta.paid`**, **`_meta.payment`: `["charge","channel"]`** for paid tools; price + token in meta.
- **`resolveAccount`:** trim `args.account` or fall back to **`config.buyerPublicKey`**.
- Paid tool JSON responses must include **`mppPayerAccount`** (buyer pubkey) and **`inspectedAccount`** so UI can show “who paid” vs “who was analyzed”.
- Implement **charge** and **channel** payment modes by wrapping MCP client with `MppClient.wrap` + `chargeClientStellar` / `channelClientStellar` with the clearable stores.
- Serialize MCP results to JSON-safe (BigInt → string).

## Supporting scripts

- **`src/mpp-client.js`:** pay for insight (pull/push) using `mppx` charge client + fetch to API base.
- **`src/mpp-channel-client.js`:** channel pay helper (`voucher` / `close` actions) per `@stellar/mpp` channel client patterns.
- **`src/client.js`:** CLI demo of paid route.
- **`src/probe.js`:** hit paid route **without** payment to show raw 402.
- **`src/keys.js`:** print keypairs + Friendbot URLs for workshop setup.

## Frontend (`public/index.html` + `public/app.js` + `public/styles.css`)

- **Hero** + explanation of 402 → Stellar payment.
- **Story cards:** raw 402, pay pull, channel inspect / activate MCP session.
- **Dev wallets panel:** `GET /api/wallets`, **Refresh** button.
- **Explorer MCP workbench:** Discover tools, Try selected without payment, Activate channel session, Run selected tool; payment rail **charge** vs **channel**; optional account **G…** input + tx **limit** for explain tool.
- **Paid result UI:** show tool payload + receipt metadata; show **MPP payer** vs **analyzed account** when present.
- **Flow steps** visual (1–4).
- **Demo output** `<pre>` for raw JSON from actions.
- **Clear output & workbench** button: reset workbench UI **and** `fetch POST /api/demo/clear-mpp-stores` (do not wipe wallet list HTML).
- **Code snippet panel:** real excerpts from **`src/server.js`** (`payment` from `mppx/express` for charge pull, push, channel) + a short **“without MPP”** sketch (public route + API-key gate).
- Use **Prism.js** from CDN for snippet highlighting (optional but reference does).

## Vercel

- **`vercel.json`:** route `/` → `index.html`; route `/api/(.*)` → **`api/index.js`**.
- **`api/index.js`:** `export default app` importing Express `app` from `../src/server.js`.

## Quality bar

- ESLint passes.
- README with setup: `npm install`, `cp example.env .env`, `npm run keys`, fund accounts, fill env, `npm run server`, open `http://localhost:3002`.
- Narrative in README: charge vs push vs channel vs MCP; warning that **Store memory** is demo-only; production should use Redis/Upstash/etc.

## Out of scope / do not claim

- Deploying the **one-way-channel** Soroban contract itself (only env slots + UI that works when configured).
- Real mainnet keys or custodial handling.

Deliver a **complete repo**: all files above, working `npm run server`, and frontend that demonstrates every route without exposing `STELLAR_SECRET_KEY` or `MPP_SECRET_KEY` to the browser (server signs demo payments).

---

_End of prompt — paste from "You are implementing" through "Deliver a complete repo" into your coding agent._
