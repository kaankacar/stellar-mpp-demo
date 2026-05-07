import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  Mppx as ChargeMppx,
  Store as ChargeStore,
  stellar as chargeServerStellar,
} from "@stellar/mpp/charge/server";
import {
  Mppx as ChannelMppx,
  getChannelState,
  stellar as channelServerStellar,
} from "@stellar/mpp/channel/server";
import { stellar as chargeClientStellar } from "@stellar/mpp/charge/client";
import { stellar as channelClientStellar } from "@stellar/mpp/channel/client";
import { McpClient } from "mppx/mcp-sdk/client";
import { Transport as MppxTransport } from "mppx/server";
import * as z from "zod/v4";
import { createClearableMemoryStore } from "./clearable-mpp-store.js";

const mcpChannelServerBacking = createClearableMemoryStore();
const mcpChannelClientBacking = createClearableMemoryStore();
const mcpChannelServerStore = mcpChannelServerBacking.store;
const mcpChannelClientStore = mcpChannelClientBacking.store;

const TOOLS = [
  {
    name: "get_network_status",
    title: "Network Status",
    paid: false,
    description: "Check whether the configured Stellar Testnet RPC is reachable.",
    inputSchema: z.object({}),
  },
  {
    name: "lookup_account",
    title: "Lookup Account",
    paid: false,
    description: "Look up the buyer account and show its live XLM balance.",
    inputSchema: accountInputSchema(),
  },
  {
    name: "analyze_account_risk",
    title: "Account Risk Analysis",
    paid: true,
    description: "Analyze whether the buyer account is ready for paid MPP calls.",
    inputSchema: accountInputSchema(),
  },
  {
    name: "explain_latest_transactions",
    title: "Explain Latest Transactions",
    paid: true,
    description: "Explain recent buyer transactions in developer-friendly language.",
    inputSchema: accountInputSchema().extend({
      limit: z.number().int().min(1).max(10).optional(),
    }),
  },
];

export function clearMcpDemoStores() {
  mcpChannelServerBacking.clear();
  mcpChannelClientBacking.clear();
}

export async function listMcpTools(config) {
  return withMcpClient(config, async ({ client }) => client.listTools());
}

export async function callFreeMcpTool(config, toolName = "lookup_account", toolArguments = {}) {
  return withMcpClient(config, async ({ client }) =>
    client.callTool({
      name: toolName,
      arguments: toolArguments,
    }),
  );
}

export async function callPaidMcpToolWithoutPayment(
  config,
  toolName = "analyze_account_risk",
  paymentMode = "charge",
  toolArguments = {},
) {
  return withMcpClient(config, async ({ client }) => {
    try {
      return await client.callTool({
        name: toolName,
        arguments: toolArguments,
      });
    } catch (error) {
      return serializeMcpError(error);
    }
  }, paymentMode);
}

export async function callPaidMcpToolWithCharge(
  config,
  demoClient,
  mode = "pull",
  toolName = "analyze_account_risk",
  toolArguments = {},
) {
  return withMcpClient(config, async ({ client }) => {
    const wrapped = McpClient.wrap(client, {
      methods: [
        chargeClientStellar({
          secretKey: demoClient.secretKey,
          mode,
          onProgress() {},
        }),
      ],
    });

    return wrapped.callTool({
      name: toolName,
      arguments: toolArguments,
    });
  }, mode === "push" ? "push" : "charge");
}

export async function callPaidMcpToolWithChannel(
  config,
  toolName = "analyze_account_risk",
  toolArguments = {},
) {
  return withMcpClient(config, async ({ client }) => {
    ensureChannelReady(config);

    const wrapped = McpClient.wrap(client, {
      methods: [
        channelClientStellar({
          commitmentKey: StellarSdk.Keypair.fromRawEd25519Seed(
            Buffer.from(config.commitmentSecret, "hex"),
          ),
          store: mcpChannelClientStore,
          onProgress() {},
        }),
      ],
    });

    return wrapped.callTool({
      name: toolName,
      arguments: toolArguments,
    });
  }, "channel");
}

export async function inspectMcpChannelSession(config) {
  ensureChannelReady(config);

  const state = await getChannelState({
    channel: config.channelContract,
    network: config.network,
    rpcUrl: config.rpcUrl,
  });

  return serializeMcpResult({
    active: true,
    note:
      "Channel session is ready. Paid MCP tools can now use off-chain vouchers without a new on-chain transaction per tool call.",
    channel: channelSummary(config, state),
  });
}

async function withMcpClient(config, callback, paymentMode = "charge") {
  const server = createMcpServer(config, paymentMode);
  const client = new Client({ name: "stellar-mpp-demo-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return serializeMcpResult(await callback({ client, server }));
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

function createMcpServer(config, paymentMode = "charge") {
  const server = new McpServer({
    name: "stellar-paid-mcp-tools",
    version: "1.0.0",
  });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        _meta: {
          paid: tool.paid,
          payment: tool.paid ? ["charge", "channel"] : [],
          price: tool.paid ? config.amount : "0",
          token: config.tokenLabel,
        },
      },
      tool.paid
        ? paidToolHandler(config, paymentMode, tool)
        : async (args) => toolResponse(await runTool(config, tool.name, "free", args)),
    );
  }

  return server;
}

function paidToolHandler(config, paymentMode, tool) {
  const payment =
    paymentMode === "channel"
      ? createChannelPayment(config)
      : createChargePayment(config, paymentMode !== "push");
  const intent = paymentMode === "channel" ? payment.channel : payment.charge;
  const modeLabel = paymentMode === "push" ? "charge-push" : paymentMode === "charge" ? "charge-pull" : "channel";

  return async (args, extra) => {
    if (paymentMode === "channel") ensureChannelReady(config);

    const result = await intent({
      amount: config.amount,
      description: `${tool.title} MCP tool via MPP ${modeLabel}`,
      meta: {
        tool: tool.name,
        paymentMode: modeLabel,
      },
    })(extra);

    if (result.status === 402) throw result.challenge;

    return result.withReceipt(toolResponse(await runTool(config, tool.name, modeLabel, args)));
  };
}

function createChargePayment(config, sponsored) {
  return ChargeMppx.create({
    realm: config.realm,
    secretKey: config.secretKey,
    transport: MppxTransport.mcpSdk(),
    methods: [
      chargeServerStellar({
        recipient: config.recipient,
        currency: config.currency,
        decimals: config.decimals,
        network: config.network,
        rpcUrl: config.rpcUrl,
        feePayer: sponsored && config.feePayerSecret ? { envelopeSigner: config.feePayerSecret } : undefined,
        store: ChargeStore.memory(),
      }),
    ],
  });
}

function createChannelPayment(config) {
  return ChannelMppx.create({
    realm: config.realm,
    secretKey: config.secretKey,
    transport: MppxTransport.mcpSdk(),
    methods: [
      channelServerStellar({
        channel: config.channelContract,
        commitmentKey: config.channelCommitmentPublicKey,
        decimals: config.decimals,
        feePayer: config.recipientSecret
          ? { envelopeSigner: config.recipientSecret }
          : { envelopeSigner: config.feePayerSecret },
        network: config.network,
        rpcUrl: config.rpcUrl,
        store: mcpChannelServerStore,
      }),
    ],
  });
}

async function accountBalance(publicKey, horizonUrl) {
  try {
    const horizon = new StellarSdk.Horizon.Server(horizonUrl);
    const account = await horizon.loadAccount(publicKey);
    const native = account.balances.find((balance) => balance.asset_type === "native");

    return {
      account: publicKey,
      exists: true,
      xlm: native?.balance ?? "0",
    };
  } catch (error) {
    return {
      account: publicKey,
      exists: false,
      xlm: "0",
      error: error.message,
    };
  }
}

async function runTool(config, toolName, mode, args = {}) {
  const account = resolveAccount(config, args);
  const snapshot = await liveSnapshot(config, account);

  if (toolName === "get_network_status") {
    return {
      tool: toolName,
      paid: false,
      resultType: "network-status",
      network: {
        name: config.network,
        rpcUrl: config.rpcUrl,
        horizonUrl: config.horizonUrl,
        rpcHealthy: await rpcHealthy(config.rpcUrl),
      },
      message: "Free MCP tool confirmed the configured Stellar network endpoints.",
    };
  }

  if (toolName === "lookup_account") {
    return {
      tool: toolName,
      paid: false,
      resultType: "account-lookup",
      accountLookup: {
        account: snapshot.target.account,
        xlm: snapshot.target.xlm,
        exists: snapshot.target.exists,
        fallbackUsed: !args.account,
      },
      message: "Free MCP tool returned a basic live account lookup.",
    };
  }

  if (toolName === "analyze_account_risk") {
    return {
      tool: toolName,
      mode,
      paid: true,
      mppPayerAccount: config.buyerPublicKey,
      inspectedAccount: account,
      resultType: "account-risk",
      riskChecks: [
        check("target account exists", snapshot.target.exists),
        check("target has XLM for fees", Number(snapshot.target.xlm) > 1),
        check("seller account exists", snapshot.seller.exists),
        check("channel is configured", Boolean(snapshot.channel)),
      ],
      target: snapshot.target,
      seller: snapshot.seller,
      channel: snapshot.channel,
      message: "Paid MCP tool analyzed the target account's readiness for MPP demo payments.",
    };
  }

  if (toolName === "explain_latest_transactions") {
    const transactions = await latestTransactions(account, config.horizonUrl, args.limit);

    return {
      tool: toolName,
      mode,
      paid: true,
      mppPayerAccount: config.buyerPublicKey,
      inspectedAccount: account,
      resultType: "transaction-explanation",
      account,
      fallbackUsed: !args.account,
      transactions,
      message:
        "Paid MCP tool explained recent target account transactions using live Horizon data.",
    };
  }

  return {
    tool: toolName,
    mode,
    paid: false,
    message: "Unknown tool.",
  };
}

async function liveSnapshot(config, account) {
  const [target, seller, channel] = await Promise.all([
    accountBalance(account, config.horizonUrl),
    accountBalance(config.recipient, config.horizonUrl),
    config.channelContract
      ? getChannelState({
          channel: config.channelContract,
          network: config.network,
          rpcUrl: config.rpcUrl,
        })
      : null,
  ]);

  return {
    target,
    seller,
    channel: channel ? channelSummary(config, channel) : null,
  };
}

function accountInputSchema() {
  return z.object({
    account: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional Stellar public key. Leave empty to use the demo buyer wallet."),
  });
}

function resolveAccount(config, args = {}) {
  const account = typeof args.account === "string" ? args.account.trim() : "";
  return account || config.buyerPublicKey;
}

async function rpcHealthy(rpcUrl) {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      }),
    });
    const body = await response.json();
    return response.ok && body.result?.status === "healthy";
  } catch {
    return false;
  }
}

async function latestTransactions(publicKey, horizonUrl, limit = 3) {
  try {
    const horizon = new StellarSdk.Horizon.Server(horizonUrl);
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 10) : 3;
    const page = await horizon.transactions().forAccount(publicKey).order("desc").limit(safeLimit).call();

    return page.records.map((transaction) => ({
      hash: transaction.hash,
      createdAt: transaction.created_at,
      successful: transaction.successful,
      operationCount: transaction.operation_count,
      feeCharged: transaction.fee_charged,
      explanation: transaction.successful
        ? `Successful transaction with ${transaction.operation_count} operation(s).`
        : "Failed transaction; inspect the result XDR for details.",
    }));
  } catch (error) {
    return [
      {
        error: error.message,
        explanation: "No recent transactions could be loaded for this account.",
      },
    ];
  }
}

function toolResponse(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function channelSummary(config, state) {
  return {
    contract: config.channelContract,
    balanceBaseUnits: state.balance.toString(),
    currentLedger: state.currentLedger,
    closeEffectiveAtLedger: state.closeEffectiveAtLedger,
    from: state.from,
    to: state.to,
  };
}

function check(label, ok) {
  return {
    label,
    ok,
  };
}

function ensureChannelReady(config) {
  if (!config.channelContract || !config.commitmentSecret || !config.channelCommitmentPublicKey) {
    throw new Error("Channel MCP tool requires CHANNEL_CONTRACT, COMMITMENT_SECRET, and COMMITMENT_PUBKEY.");
  }
}

function serializeMcpResult(result) {
  return JSON.parse(
    JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  );
}

function serializeMcpError(error) {
  return {
    error: true,
    name: error?.name,
    message: error?.message,
    code: error?.code,
    data: error?.data,
  };
}
