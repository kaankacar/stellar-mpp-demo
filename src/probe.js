import "dotenv/config";
import { readOptional } from "./config.js";

const apiBaseUrl = readOptional("API_BASE_URL", "http://localhost:3002");
const url = new URL("/api/paid-insight", apiBaseUrl);

const response = await fetch(url);

console.log(`HTTP ${response.status}`);
console.log("WWW-Authenticate challenge headers:");

const challenges = response.headers.getSetCookie
  ? response.headers.get("www-authenticate")
  : response.headers.get("www-authenticate");

console.log(challenges ?? "(none)");

try {
  console.log(await response.json());
} catch {
  console.log(await response.text());
}
