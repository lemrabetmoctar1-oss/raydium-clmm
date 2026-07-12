import { Keypair } from "@solana/web3.js";

describe("get admin pubkey", () => {
  it("prints a fresh keypair to use as admin", () => {
    const testAdmin = Keypair.generate();
    console.log("TEST_ADMIN_PUBKEY:", testAdmin.publicKey.toBase58());
    console.log("TEST_ADMIN_SECRET:", JSON.stringify(Array.from(testAdmin.secretKey)));
  });
});
