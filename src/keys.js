import { Keypair } from "@stellar/stellar-sdk";

const server = Keypair.random();
const client = Keypair.random();
const feePayer = Keypair.random();

console.log("Server recipient account");
console.log(`  public: ${server.publicKey()}`);
console.log(`  secret: ${server.secret()}`);
console.log("");
console.log("Client paying account");
console.log(`  public: ${client.publicKey()}`);
console.log(`  secret: ${client.secret()}`);
console.log("");
console.log("Optional fee payer account");
console.log(`  public: ${feePayer.publicKey()}`);
console.log(`  secret: ${feePayer.secret()}`);
console.log("");
console.log("Fund these on Testnet with Friendbot:");
console.log(`  https://friendbot.stellar.org?addr=${server.publicKey()}`);
console.log(`  https://friendbot.stellar.org?addr=${client.publicKey()}`);
console.log(`  https://friendbot.stellar.org?addr=${feePayer.publicKey()}`);
