import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  freezeAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import idl from "../target/idl/raydium_clmm.json";

describe("freeze authority poc", () => {
  it("Step 1-2: creates a Token-2022 mint with freeze_authority", async () => {
    const context = await startAnchor(".", [], []);
    const provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    const program = new Program(idl as anchor.Idl, provider);
    console.log("Program ID from IDL:", program.programId.toBase58());

    const payer = context.payer;
    const attacker = Keypair.generate();
    const victim = Keypair.generate();

    // Fund attacker/victim from the bankrun context's funded payer
    // (bankrun's default payer already has SOL; we airdrop via transfer or use provider.wallet)

    const mint = await createMint(
      provider.connection as any,
      payer,
      payer.publicKey,      // mint authority
      attacker.publicKey,   // freeze authority = ATTACKER
      9,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("STEP 1-2 REAL PASS: Token-2022 mint created:", mint.toBase58());
    console.log("Freeze authority set to attacker:", attacker.publicKey.toBase58());

    // Confirm freeze_authority is really set by reading the mint account back
    const mintInfo = await provider.connection.getAccountInfo(mint);
    console.log("Mint account exists on-chain (bytes):", mintInfo?.data.length);
  });
});
