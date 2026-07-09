// CORE VERIFICATION: Does classic SPL Token support freeze_authority?
// This MUST work before we can claim the exploit

const { Connection, PublicKey, Keypair, Transaction } = require("@solana/web3.js");
const { 
  createMint, 
  createAssociatedTokenAccount, 
  mintTo, 
  getAccount, 
  freezeAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} = require("@solana/spl-token");

async function testClassicTokenFreeze() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Load payer
  const fs = require("fs");
  const payerKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/Users/walata/.config/solana/id.json", "utf-8")))
  );
  
  const attacker = Keypair.generate();
  const victim = Keypair.generate();
  
  console.log("=== VERIFICATION: Classic Token freeze_authority ===");
  
  // Fund
  for (const kp of [attacker, victim]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 10 * 1e9);
    await connection.confirmTransaction(sig);
  }
  console.log("✓ Funded\n");
  
  // Create classic Token mint with freeze authority = attacker
  console.log("[1] Creating classic Token mint with freeze_authority = attacker...");
  const mint = await createMint(
    connection, 
    attacker, 
    attacker.publicKey,    // mint authority
    attacker.publicKey,    // freeze authority - attacker controls this!
    9,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID       // CLASSIC Token, not Token-2022
  );
  
  console.log(`   Mint: ${mint.toBase58()}`);
  console.log(`   Owner program: ${connection._commitment}`);
  
  // Verify owner
  const mintInfo = await connection.getAccountInfo(mint);
  console.log(`   Real owner: ${mintInfo.owner.toBase58()}`);
  console.log(`   Is classic Token: ${mintInfo.owner.equals(TOKEN_PROGRAM_ID)}`);
  console.log(`   Is Token-2022: ${mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)}\n`);
  
  // Create account and mint tokens
  const ata = await createAssociatedTokenAccount(connection, attacker, mint, attacker.publicKey);
  await mintTo(connection, attacker, mint, ata, attacker, 1000000000n);
  
  // Check before freeze
  const before = await getAccount(connection, ata);
  console.log(`[2] Before freeze: state=${before.state}, amount=${before.amount}`);
  
  // FREEZE using classic Token program
  console.log("\n[3] Executing freeze_account (classic Token)...");
  try {
    const freezeSig = await freezeAccount(connection, attacker, ata, mint, attacker.publicKey);
    await connection.confirmTransaction(freezeSig);
    console.log(`   ✓ Freeze succeeded: ${freezeSig}`);
    
    // Check after
    const after = await getAccount(connection, ata);
    console.log(`   After freeze: state=${after.state}`);
    console.log(`   Frozen = 2: ${after.state === 2}`);
    
    console.log("\n[4] CRITICAL CONFIRMED:");
    console.log("   Classic SPL Token DOES support freeze_authority");
    console.log("   freeze_account instruction WORKS on classic Token");
    console.log("   Any account with that mint can be frozen");
    
  } catch (e) {
    console.log(`   ✗ Freeze FAILED: ${e.message?.substring(0,200)}`);
    console.log("\n   This means classic Token does NOT support freeze_account");
    console.log("   Bug is Token-2022 ONLY (less severe)");
  }
}

testClassicTokenFreeze().catch(console.error);