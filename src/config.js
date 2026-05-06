import "dotenv/config";

export const XLM_SAC_TESTNET = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const USDC_SAC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export function readOptional(name, fallback = undefined) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export function readRequired(name) {
  const value = readOptional(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function readNumber(name, fallback) {
  const raw = readOptional(name);
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Expected ${name} to be a number, got "${raw}"`);
  }
  return value;
}

export function serverConfig() {
  return {
    port: readNumber("PORT", 3002),
    realm: readOptional("MPP_REALM", "localhost:3002"),
    secretKey: readRequired("MPP_SECRET_KEY"),
    recipient: readRequired("STELLAR_RECIPIENT"),
    recipientSecret: readOptional("STELLAR_RECIPIENT_SECRET"),
    currency: readOptional("STELLAR_TOKEN_CONTRACT", XLM_SAC_TESTNET),
    tokenLabel: readOptional("STELLAR_TOKEN_LABEL", "XLM"),
    decimals: readNumber("STELLAR_TOKEN_DECIMALS", 7),
    amount: readOptional("MPP_PRICE", "0.00001"),
    network: readOptional("STELLAR_NETWORK", "stellar:testnet"),
    rpcUrl: readOptional("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org"),
    horizonUrl: readOptional("STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org"),
    feePayerSecret: readOptional("FEE_PAYER_SECRET"),
    channelContract: readOptional("CHANNEL_CONTRACT"),
    commitmentSecret: readOptional("COMMITMENT_SECRET"),
    commitmentPubkey: readOptional("COMMITMENT_PUBKEY"),
    channelDeposit: readOptional("CHANNEL_DEPOSIT", "0.001"),
  };
}

export function clientConfig() {
  return {
    apiBaseUrl: readOptional("API_BASE_URL", "http://localhost:3002"),
    secretKey: readRequired("STELLAR_SECRET_KEY"),
  };
}
