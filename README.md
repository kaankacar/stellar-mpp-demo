# Stellar MPP Demo

A live-coding demo that builds a paid API which answers with
`402 Payment Required`, then lets a client pay through MPP on Stellar Testnet.
The root URL serves a small frontend so the full flow is visible.

The app is a small protocol lab. Charge mode runs real Stellar Testnet
payments. Channel mode uses a deployed one-way channel contract on Testnet:
vouchers are off-chain, and close settlement is on-chain.

## What You Will Show

1. A free API route works without payment.
2. A paid API route returns an MPP `402` challenge.
3. The client signs a Stellar payment credential.
4. The server submits/verifies the payment and returns premium data.
5. Push mode shows the client-submitted transaction path.
6. Channel mode shows the live deposit, off-chain cumulative vouchers, and on-chain close.
7. Stellar Explorer MCP shows free lookup tools and paid analysis tools with the same MPP flows.

## Project Structure

- `src/server.js` runs the Express API and protects `/api/paid-insight`.
- `src/client.js` calls the paid route with an MPP-aware fetch client.
- `src/mpp-client.js` contains the reusable MPP charge client helper.
- `src/mcp-demo.js` contains the local paid MCP server/client demo.
- `src/probe.js` calls the paid route without payment so you can show the raw `402`.
- `src/keys.js` generates demo Stellar keypairs and Friendbot links.
- `public/` contains the protocol lab frontend.
- `example.env` documents the required environment variables.

## Setup

Use Node 20 or newer.

```bash
npm install
cp example.env .env
npm run keys
```

Fund the generated accounts with the printed Friendbot links, then update `.env`:

```bash
STELLAR_RECIPIENT=G_SERVER_PUBLIC_KEY
STELLAR_SECRET_KEY=S_CLIENT_SECRET_KEY
```

The default token is the native XLM Stellar Asset Contract on Testnet, which is
the easiest live demo path because Friendbot funding is enough to begin.

For a USDC-flavored demo, change these values after creating trustlines and
funding with Testnet USDC:

```bash
STELLAR_TOKEN_CONTRACT=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
STELLAR_TOKEN_LABEL=USDC
```

## Run The Demo

Start the API:

```bash
npm run server
```

Open the frontend:

```text
http://localhost:3002
```

In another terminal, show the unprotected route:

```bash
curl http://localhost:3002/api/free-insight
```

Show the payment challenge:

```bash
npm run probe
```

Make the paid request:

```bash
npm run client
```

The client logs the MPP lifecycle: challenge, signing, payment submission,
confirmation, and the final paid response.

The frontend has these flows:

1. Refresh/fund demo wallets.
2. Call the free preview route.
3. Show the raw `402` MPP challenge.
4. Pay with charge pull mode.
5. Pay with charge push mode.
6. Inspect the deployed channel, sign cumulative vouchers, and close it.
7. Discover Stellar Explorer MCP tools, call free lookup tools, then unlock paid analysis tools with charge or channel payment.

The browser does not receive Stellar secret keys. The frontend calls local API
endpoints, and the local server signs/submits the configured Testnet actions.

The MCP section uses the official MCP TypeScript SDK in-memory transport. It
exposes free explorer tools (`get_network_status`, `lookup_account`) and paid
analysis tools (`analyze_account_risk`, `explain_latest_transactions`) that
require MPP credentials in MCP metadata before returning results.
Explorer tools accept optional inputs: account-based tools take an `account`
public key, and `explain_latest_transactions` also accepts a `limit`. Leaving
the account blank uses the demo buyer wallet, which keeps the live demo easy to
run.

## Walkthrough

Start by opening the frontend and the wallet panel:

1. Buyer wallet pays.
2. Seller wallet receives.
3. Fee payer is optional for sponsored pull mode.
4. Commitment key signs channel vouchers but is not the payment account.

Then open `src/server.js` and explain that the paid endpoint is ordinary
Express code with one extra middleware: `payment(...)`.

Then open `src/client.js` and show that the client still uses `fetch`, but it is
wrapped by MPP so the `402` challenge is handled automatically.

Suggested narrative:

1. "HTTP already has a status code for payment required."
2. "MPP gives the server a standard way to describe what payment it accepts."
3. "The client chooses a supported method and creates a credential."
4. "On Stellar, charge mode settles with a Soroban token transfer."
5. "Pull mode means the client signs and the server submits."
6. "Push mode means the client submits and returns a hash."
7. "For many calls per session, channel mode moves per-request payment off-chain."

## Channel Mode Extension

Channel mode is the follow-up demo:

1. Deploy a one-way channel Soroban contract.
2. Deposit funds once.
3. Sign cumulative off-chain commitments for every request.
4. Close the channel once to settle the final total.

That creates the main contrast:

- Charge mode is easiest to understand and debug.
- Channel mode is better for agents making many paid tool calls.

This demo expects `CHANNEL_CONTRACT`, `COMMITMENT_SECRET`, and `COMMITMENT_PUBKEY`
to be configured. The UI path does not include a local channel fallback.

## Production Notes

`Store.memory()` is for demos only. A real server should use a persistent store
such as Redis or Postgres-backed storage for replay protection.

Use a dedicated fee payer if you want clients to avoid holding extra XLM for
transaction fees. This demo supports that through `FEE_PAYER_SECRET`.

Never commit real secrets. Keep `.env` local.
