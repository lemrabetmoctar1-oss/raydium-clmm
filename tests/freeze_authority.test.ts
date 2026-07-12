import * as anchor from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";

describe("freeze authority poc", () => {
  it("Step 1: loads the program via bankrun", async () => {
    const context = await startAnchor(".", [], []);
    const provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    console.log("STEP 1 REAL PASS: bankrun context started, program loaded from Anchor.toml");
    console.log("payer pubkey:", provider.wallet.publicKey.toBase58());
  });
});
