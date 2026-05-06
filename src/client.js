import { clientConfig } from "./config.js";
import { payForInsight } from "./mpp-client.js";

const config = clientConfig();

const result = await payForInsight({
  apiBaseUrl: config.apiBaseUrl,
  secretKey: config.secretKey,
  mode: process.env.MPP_CHARGE_MODE === "push" ? "push" : "pull",
  onProgress(event) {
    switch (event.type) {
      case "challenge":
        console.log(`Received challenge: pay ${event.amount} of ${event.currency}`);
        break;
      case "signing":
        console.log("Signing Soroban authorization...");
        break;
      case "signed":
        console.log("Signed payment credential.");
        break;
      case "paying":
        console.log("Server is submitting the payment transaction...");
        break;
      case "confirming":
        console.log(`Waiting for confirmation: ${event.hash}`);
        break;
      case "paid":
        console.log(`Payment settled: ${event.hash}`);
        break;
      default:
        console.log("MPP event:", event);
    }
  },
});

console.log(`HTTP ${result.status}`);
console.log("Payment-Receipt:", result.receipt ?? "(none)");
console.log(result.body);
