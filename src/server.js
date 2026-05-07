import express from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { payment } from "mppx/express";
import { Mppx, Store, stellar } from "@stellar/mpp/charge/server";
import {
  getChannelState,
  Mppx as ChannelMppx,
  Store as ChannelStore,
  stellar as channelStellar,
} from "@stellar/mpp/channel/server";
import { clientConfig, serverConfig } from "./config.js";
import { payForInsight } from "./mpp-client.js";
import { payForChannelInsight } from "./mpp-channel-client.js";
import {
  callFreeMcpTool,
  callPaidMcpToolWithChannel,
  callPaidMcpToolWithCharge,
  callPaidMcpToolWithoutPayment,
  inspectMcpChannelSession,
  listMcpTools,
} from "./mcp-demo.js";

const config = serverConfig();
const demoClient = clientConfig();
const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);
const buyerKeypair = StellarSdk.Keypair.fromSecret(demoClient.secretKey);
const feePayerKeypair = config.feePayerSecret
  ? StellarSdk.Keypair.fromSecret(config.feePayerSecret)
  : undefined;
const commitmentKeypair = config.commitmentSecret
  ? StellarSdk.Keypair.fromRawEd25519Seed(Buffer.from(config.commitmentSecret, "hex"))
  : undefined;
const channelCommitmentPublicKey = config.commitmentPubkey
  ? StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.from(config.commitmentPubkey, "hex"))
  : commitmentKeypair?.publicKey();
const mcpDemoConfig = {
  ...config,
  buyerPublicKey: buyerKeypair.publicKey(),
  channelCommitmentPublicKey,
};

const feePayer = config.feePayerSecret
  ? { envelopeSigner: config.feePayerSecret }
  : undefined;
const channelFeePayer = config.recipientSecret
  ? { envelopeSigner: config.recipientSecret }
  : feePayer;

const mppx = Mppx.create({
  realm: config.realm,
  secretKey: config.secretKey,
  methods: [
    stellar({
      recipient: config.recipient,
      currency: config.currency,
      decimals: config.decimals,
      network: config.network,
      rpcUrl: config.rpcUrl,
      feePayer,
      store: Store.memory(),
    }),
  ],
});

const pushMppx = Mppx.create({
  realm: config.realm,
  secretKey: config.secretKey,
  methods: [
    stellar({
      recipient: config.recipient,
      currency: config.currency,
      decimals: config.decimals,
      network: config.network,
      rpcUrl: config.rpcUrl,
      store: Store.memory(),
    }),
  ],
});

const channelStore = ChannelStore.memory();
const channelMppx =
  config.channelContract && channelCommitmentPublicKey
    ? ChannelMppx.create({
        realm: config.realm,
        secretKey: config.secretKey,
        methods: [
          channelStellar({
            channel: config.channelContract,
            commitmentKey: channelCommitmentPublicKey,
            decimals: config.decimals,
            feePayer: channelFeePayer,
            network: config.network,
            rpcUrl: config.rpcUrl,
            store: channelStore,
          }),
        ],
      })
    : null;

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.get("/api/status", (_req, res) => {
  res.json({
    name: "Stellar MPP Demo",
    routes: {
      free: "/api/free-insight",
      paid: "/api/paid-insight",
      paidPush: "/api/paid-insight-push",
      demoPay: "/api/demo-pay",
      wallets: "/api/wallets",
      channel: "/api/channel/state",
      mcp: "/api/mcp/tools",
    },
    price: `${config.amount} ${config.tokenLabel}`,
    network: config.network,
    modeSupport: {
      chargePull: true,
      chargePush: true,
      feeSponsoredPull: Boolean(feePayer),
      channelContractConfigured: Boolean(config.channelContract),
      channelOnChain: Boolean(channelMppx),
    },
  });
});

app.get("/api/free-insight", (_req, res) => {
  res.json({
    paid: false,
    insight: "Free preview: MPP lets APIs answer with HTTP 402 before serving premium data.",
  });
});

app.get(
  "/api/paid-insight",
  // MPP: this middleware makes the route paid (HTTP 402 until Stellar payment succeeds).
  payment(mppx.charge, {
    amount: config.amount,
    description: "One premium AI-agent market insight",
    meta: {
      demo: "stellar-mpp-demo",
    },
  }),
  (_req, res) => {
    res.json({
      paid: true,
      insight:
        "Premium insight: charge mode is easiest to teach; channel mode is the scaling story for high-frequency agents.",
      nextStep:
        "Replace this route body with a real model call, MCP tool result, or paid data feed.",
      price: `${config.amount} ${config.tokenLabel}`,
    });
  },
);

app.get(
  "/api/paid-insight-push",
  // MPP: push charge — buyer submits the tx and proves with hash (no pull fee sponsor here).
  payment(pushMppx.charge, {
    amount: config.amount,
    description: "One premium AI-agent market insight via push mode",
    meta: {
      demo: "stellar-mpp-demo",
      mode: "push",
    },
  }),
  (_req, res) => {
    res.json({
      paid: true,
      mode: "push",
      insight:
        "Premium insight: push mode means the client submitted the transaction and sent the tx hash as proof.",
      price: `${config.amount} ${config.tokenLabel}`,
    });
  },
);

app.post("/api/demo-pay", async (_req, res, next) => {
  const events = [];
  const mode = _req.body?.mode === "push" ? "push" : "pull";

  try {
    const result = await payForInsight({
      apiBaseUrl: demoClient.apiBaseUrl,
      secretKey: demoClient.secretKey,
      mode,
      path: mode === "push" ? "/api/paid-insight-push" : "/api/paid-insight",
      onProgress(event) {
        events.push(event);
      },
    });

    res.json({
      ...result,
      mode,
      settlement: mode === "push" ? "client-submitted transaction" : "server-submitted pull credential",
      events,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/wallets", async (_req, res) => {
  res.json({
    network: config.network,
    horizonUrl: config.horizonUrl,
    token: {
      label: config.tokenLabel,
      contract: config.currency,
      decimals: config.decimals,
      requestPrice: config.amount,
    },
    wallets: await Promise.all([
      describeWallet({
        role: "buyer",
        label: "Agent / Buyer Wallet",
        publicKey: buyerKeypair.publicKey(),
        purpose: "Signs and pays for protected API requests.",
        canFund: true,
      }),
      describeWallet({
        role: "seller",
        label: "API Seller Wallet",
        publicKey: config.recipient,
        purpose: "Receives the charge-mode payment.",
        canFund: true,
      }),
      describeWallet({
        role: "feePayer",
        label: "Fee Payer Wallet",
        publicKey: feePayerKeypair?.publicKey(),
        purpose: "Optional sponsor for pull-mode network fees.",
        canFund: Boolean(feePayerKeypair),
        missingReason: feePayerKeypair ? undefined : "FEE_PAYER_SECRET is not configured.",
      }),
      {
        role: "commitment",
        label: "Channel Commitment Key",
        publicKey: channelCommitmentPublicKey ?? null,
        rawPublicKey: config.commitmentPubkey ?? null,
        balance: null,
        funded: null,
        purpose:
          "Signs off-chain cumulative channel commitments. This is not the payment wallet.",
        canFund: false,
        missingReason: channelCommitmentPublicKey ? undefined : "COMMITMENT_SECRET is not configured.",
      },
    ]),
  });
});

app.post("/api/wallets/fund", async (req, res, next) => {
  const publicKey = publicKeyForRole(req.body?.role);

  if (!publicKey) {
    res.status(400).json({
      error: "Unknown or unfundable wallet role.",
      fundableRoles: ["buyer", "seller", "feePayer"],
    });
    return;
  }

  try {
    const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
    const body = await response.text();

    res.status(response.ok ? 200 : 502).json({
      role: req.body.role,
      publicKey,
      ok: response.ok,
      friendbotStatus: response.status,
      body: parseMaybeJson(body),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/channel/state", (_req, res) => {
  if (!ensureChannelConfigured(res)) return;

  getChannelState({
    channel: config.channelContract,
    network: config.network,
    rpcUrl: config.rpcUrl,
  })
    .then((state) => {
      res.json({
        mode: "on-chain",
        contract: config.channelContract,
        stellarExpert: `https://stellar.expert/explorer/testnet/contract/${config.channelContract}`,
        state: serializeChannelState(state),
      });
    })
    .catch((error) => {
      res.status(502).json({
        error: error.message,
      });
    });
});

app.post("/api/channel/reset", (_req, res) => {
  res.status(410).json({
    error:
      "Reset is disabled because this demo is configured for real on-chain channel state.",
  });
});

app.post("/api/channel/open", (_req, res) => {
  if (!ensureChannelConfigured(res)) return;

  getChannelState({
    channel: config.channelContract,
    network: config.network,
    rpcUrl: config.rpcUrl,
  })
    .then((state) => {
      res.json({
        action: "inspect-open-channel",
        mode: "on-chain",
        note: "The channel was opened on-chain during configuration; this button now reads the live contract state.",
        contract: config.channelContract,
        stellarExpert: `https://stellar.expert/explorer/testnet/contract/${config.channelContract}`,
        state: serializeChannelState(state),
      });
    })
    .catch((error) => {
      res.status(502).json({
        error: error.message,
      });
    });
});

app.get(
  "/api/channel-paid-insight",
  channelMppx
    ? // MPP channel: authorize with a voucher (402 until valid commitment); settle on channel close.
      payment(channelMppx.channel, {
        amount: config.amount,
        description: "One premium AI-agent insight via MPP channel",
        meta: {
          demo: "stellar-mpp-demo",
        },
      })
    : (_req, res) => {
        res.status(503).json({
          error:
            "Real channel mode is not configured. Set CHANNEL_CONTRACT, COMMITMENT_SECRET, and COMMITMENT_PUBKEY.",
        });
      },
  (_req, res) => {
    res.json({
      paid: true,
      mode: "channel",
      insight:
        "Premium insight: this request was authorized by an off-chain cumulative channel commitment.",
      settlement:
        "No transaction was submitted for this request; the latest commitment can be closed on-chain.",
      price: `${config.amount} ${config.tokenLabel}`,
    });
  },
);

app.post("/api/channel/request", async (_req, res, next) => {
  if (!ensureChannelConfigured(res)) return;

  const events = [];

  try {
    const result = await payForChannelInsight({
      apiBaseUrl: demoClient.apiBaseUrl,
      commitmentSecret: config.commitmentSecret,
      action: "voucher",
      onProgress(event) {
        events.push(event);
      },
    });

    res.json({
      ...result,
      action: "voucher",
      events,
      onChainState: serializeChannelState(
        await getChannelState({
          channel: config.channelContract,
          network: config.network,
          rpcUrl: config.rpcUrl,
        }),
      ),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/channel/close", async (_req, res, next) => {
  if (!ensureChannelConfigured(res)) return;

  const events = [];

  try {
    const result = await payForChannelInsight({
      apiBaseUrl: demoClient.apiBaseUrl,
      commitmentSecret: config.commitmentSecret,
      action: "close",
      onProgress(event) {
        events.push(event);
      },
    });

    res.json({
      ...result,
      action: "close",
      events,
      onChainState: serializeChannelState(
        await getChannelState({
          channel: config.channelContract,
          network: config.network,
          rpcUrl: config.rpcUrl,
        }),
      ),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/mcp/tools", async (_req, res, next) => {
  try {
    res.json(await listMcpTools(mcpDemoConfig));
  } catch (error) {
    next(error);
  }
});

app.post("/api/mcp/free", async (_req, res, next) => {
  try {
    res.json(await callFreeMcpTool(mcpDemoConfig, _req.body?.toolName, _req.body?.arguments));
  } catch (error) {
    next(error);
  }
});

app.post("/api/mcp/no-payment", async (_req, res, next) => {
  try {
    const paymentMode = _req.body?.paymentMode === "channel" ? "channel" : "charge";
    res.json(
      await callPaidMcpToolWithoutPayment(
        mcpDemoConfig,
        _req.body?.toolName,
        paymentMode,
        _req.body?.arguments,
      ),
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/mcp/charge", async (req, res, next) => {
  try {
    const mode = req.body?.mode === "push" ? "push" : "pull";
    res.json(
      await callPaidMcpToolWithCharge(
        mcpDemoConfig,
        demoClient,
        mode,
        req.body?.toolName,
        req.body?.arguments,
      ),
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/mcp/channel", async (_req, res, next) => {
  try {
    res.json(
      await callPaidMcpToolWithChannel(mcpDemoConfig, _req.body?.toolName, _req.body?.arguments),
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/mcp/channel/session", async (_req, res, next) => {
  try {
    res.json(await inspectMcpChannelSession(mcpDemoConfig));
  } catch (error) {
    next(error);
  }
});

if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`Stellar MPP demo server: http://localhost:${config.port}`);
    console.log(`Paid route: http://localhost:${config.port}/api/paid-insight`);
    console.log(`Price: ${config.amount} ${config.tokenLabel}`);
    console.log(`Network: ${config.network}`);
  });
}

export default app;

async function describeWallet({ role, label, publicKey, purpose, canFund, missingReason }) {
  const balance = publicKey ? await loadNativeBalance(publicKey) : null;

  return {
    role,
    label,
    publicKey: publicKey ?? null,
    shortPublicKey: publicKey ? shortKey(publicKey) : null,
    balance,
    funded: balance ? balance.exists : false,
    purpose,
    canFund,
    missingReason,
  };
}

async function loadNativeBalance(publicKey) {
  try {
    const account = await horizon.loadAccount(publicKey);
    const native = account.balances.find((balance) => balance.asset_type === "native");

    return {
      exists: true,
      xlm: native?.balance ?? "0",
    };
  } catch (error) {
    return {
      exists: false,
      xlm: "0",
      error: error.response?.status === 404 ? "not funded" : error.message,
    };
  }
}

function publicKeyForRole(role) {
  if (role === "buyer") return buyerKeypair.publicKey();
  if (role === "seller") return config.recipient;
  if (role === "feePayer") return feePayerKeypair?.publicKey();
  return null;
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatBaseUnits(amount, decimals) {
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

function shortKey(key) {
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

function ensureChannelConfigured(res) {
  if (channelMppx && config.channelContract && config.commitmentSecret) return true;

  res.status(503).json({
    error:
      "Real channel mode is not configured. Set CHANNEL_CONTRACT, COMMITMENT_SECRET, and COMMITMENT_PUBKEY.",
  });
  return false;
}

function serializeChannelState(state) {
  return {
    balance: formatBaseUnits(state.balance, config.decimals),
    balanceBaseUnits: state.balance.toString(),
    refundWaitingPeriod: state.refundWaitingPeriod,
    token: state.token,
    from: state.from,
    to: state.to,
    closeEffectiveAtLedger: state.closeEffectiveAtLedger,
    currentLedger: state.currentLedger,
  };
}
