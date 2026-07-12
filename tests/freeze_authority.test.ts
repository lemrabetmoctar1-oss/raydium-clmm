import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
  TOKEN_2022_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import idl from "../target/idl/raydium_clmm.json";

describe("freeze authority poc", () => {
  it("Step 1-2: creates a Token-2022 mint with freeze_authority", async () => {
    const context = await startAnchor(".", [], []);
    const client = context.banksClient;
    const payer = context.payer;
    const provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    const program = new Program(idl as anchor.Idl, provider);
    console.log("Program ID from IDL:", program.programId.toBase58());

    const attacker = Keypair.generate();
    const mint = Keypair.generate();

    const rent = await client.getRent();
    const lamports = Number(rent.minimumBalance(BigInt(MINT_SIZE)));

    const tx = new Transaction();
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mint.publicKey,
        9,
        payer.publicKey,       // mint authority
        attacker.publicKey,    // freeze authority = ATTACKER
        TOKEN_2022_PROGRAM_ID
      )
    );

    const [blockhash] = await client.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer, mint);

    const result = await client.processTransaction(tx);
    console.log("STEP 1-2 REAL PASS: Token-2022 mint created:", mint.publicKey.toBase58());
    console.log("Freeze authority set to attacker:", attacker.publicKey.toBase58());
    console.log("Transaction result:", result);

    const mintAccount = await client.getAccount(mint.publicKey);
    console.log("Mint account exists, data length:", mintAccount?.data.length);
  });
});
