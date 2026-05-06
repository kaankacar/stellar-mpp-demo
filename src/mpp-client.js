import { Mppx, stellar } from "@stellar/mpp/charge/client";

export async function payForInsight({
  apiBaseUrl,
  secretKey,
  mode = "pull",
  path = "/api/paid-insight",
  onProgress = () => {},
}) {
  const url = new URL(path, apiBaseUrl);

  const mppx = Mppx.create({
    polyfill: false,
    methods: [
      stellar({
        secretKey,
        mode,
        onProgress,
      }),
    ],
  });

  const response = await mppx.fetch(url);
  const body = await response.json();

  return {
    status: response.status,
    receipt: response.headers.get("payment-receipt"),
    body,
  };
}
