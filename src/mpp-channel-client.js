import { Keypair } from "@stellar/stellar-sdk";
import { Mppx, stellar } from "@stellar/mpp/channel/client";

export async function payForChannelInsight({
  apiBaseUrl,
  commitmentSecret,
  action = "voucher",
  onProgress = () => {},
}) {
  const url = new URL("/api/channel-paid-insight", apiBaseUrl);
  const commitmentKey = Keypair.fromRawEd25519Seed(Buffer.from(commitmentSecret, "hex"));

  const mppx = Mppx.create({
    polyfill: false,
    methods: [
      stellar({
        commitmentKey,
        onProgress,
      }),
    ],
  });

  const response = await mppx.fetch(url, {
    context: {
      action,
    },
  });
  const body = await response.json();

  return {
    status: response.status,
    receipt: response.headers.get("payment-receipt"),
    body,
  };
}
