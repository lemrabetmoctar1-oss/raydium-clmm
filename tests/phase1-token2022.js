// Phase 1: Token-2022 freeze - auto-detect deployed program
const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require("@solana/web3.js");
const { execSync } = require("child_process");

// First deploy Token-2022 and capture the address
const { spawnSync } = require("child_process");
const deployResult = spawnSync("solana", [
  "program", "deploy",
  "/Users/walata/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/solana-program-test-2.3.13/src/programs/spl_token_2022-8.0.0.so",
  "--output", "json"
], { encoding: "utf8" });

const deployInfo = JSON.parse(deployResult.stdout);
const MY_TOKEN_2022 = new PublicKey(deployInfo.programId);
console.log(`Token-2022 deployed at: ${MY_TOKEN_2022.toBase58()}`);

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const attacker = Keypair.generate();

  console.log("[1] Funding attacker...");
  const sig = await connection.requestAirdrop(attacker.publicKey, 10 * 1e9);
  await connection.confirmTransaction(sig);
  console.log("   ✓ Funded\n");

  // Create mint using raw instructions
  console.log("[2] Create Token-2022 mint with freeze_authority...");
  const mintKp = Keypair.generate();
  const mintLamports = await connection.getMinimumBalanceForRentExemption(82);
  
  // InitializeMint2 instruction (index 20 for Token-2022)
  const mintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: attacker.publicKey,
      newAccountPubkey: mintKp.publicKey,
      space: 82,
      lamports: mintLamports,
      programId: MY_TOKEN_2022,
    }),
    {
      programId: MY_TOKEN_2022,
      keys: [
        { pubkey: mintKp.publicKey, isSigner: true, isWritable: true },
      ],
      data: Buffer.concat([
        Buffer.from([20]), // InitializeMint2
        Buffer.alloc(4),   // decimals (9) 
      ])
      // This is wrong format but let's try
    }
  );
  
  // Actually let's just use the @solana/spl-token createMint which works
  const { createMint } = require("@solana/spl-token");
  const mint = await createMint(connection, attacker, attacker.publicKey, attacker.publicKey, 9, undefined, undefined, MY_TOKEN_2022);
  console.log(`   Mint: ${mint.toBase58()}`);
  
  const mintInfo = await connection.getAccountInfo(mint);
  console.log(`   Mint owner: ${mintInfo.owner.toBase58()}\n`);

  // Create account manually with InitializeAccount3
  console.log("[3] Create token account...");
  const acctKp = Keypair.generate();
  const acctLamports = await connection.getMinimumBalanceForRentExemption(165);
  
  const acctTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: attacker.publicKey,
      newAccountPubkey: acctKp.publicKey,
      space: 165,
      lamports: acctLamports,
      programId: MY_TOKEN_2022,
    }),
    {
      programId: MY_TOKEN_2022,
      keys: [
        { pubkey: acctKp.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: attacker.publicKey, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([18]), // InitializeAccount3
    }
  );
  await connection.sendTransaction(acctTx, [attacker, acctKp]);
  console.log(`   Account: ${acctKp.publicKey.toBase58()}\n`);

  // Mint tokens
  console.log("[4] Mint tokens...");
  // MintTo = instruction 7, needs amount (u64) LE
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(BigInt(1000000000));
  
  const mintTx2 = new Transaction().add({
    programId: MY_TOKEN_2022,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: acctKp.publicKey, isSigner: false, isWritable: true },
      { pubkey: attacker.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([7]), amount]),
  });
  try {
    await connection.sendTransaction(mintTx2, [attacker]);
    console.log("   ✓ Minted\n");
  } catch(e) {
    console.log(`   Mint failed: ${e.message?.substring(0,200)}\n`);
    // Try MintToChecked (instruction 15) with decimals
    const bt = Buffer.alloc(8);
    bt.writeBigUInt64LE(BigInt(1000000000));
    const mintTx3 = new Transaction().add({
      programId: MY_TOKEN_2022,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: acctKp.publicKey, isSigner: false, isWritable: true },
        { pubkey: attacker.publicKey, isSigner: true, isWritable: false },
        [],
      ],
      data: Buffer.concat([Buffer.from([15]), bt, Buffer.from([9])]), // MintToChecked = 15
    });
    await connection.sendTransaction(mintTx3, [attacker]);
    console.log("   ✓ Minted (MintToChecked)\n");
  }

  // Check state
  const acctInfo = await connection.getAccountInfo(acctKp.publicKey);
  console.log("[5] State before freeze:");
  console.log(`   Owner: ${acctInfo.owner.toBase58()}`);
  console.log(`   AccountState byte: ${acctInfo.data[66]}`);
  console.log(`   Amount bytes 64-72: ${Array.from(acctInfo.data.slice(64,72)).join(",")}\n`);

  // Freeze
  console.log("[6] Execute freeze_account...");
  const freezeTx = new Transaction().add({
    programId: MY_TOKEN_2022,
    keys: [
      { pubkey: acctKp.publicKey, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: attacker.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([10]), // FreezeAccount
  });
  const freezeSig = await connection.sendTransaction(freezeTx, [attacker]);
  await connection.confirmTransaction(freezeSig);
  console.log(`   ✓ Freeze tx: ${freezeSig}\n`);

  // Verify frozen
  const afterInfo = await connection.getAccountInfo(acctKp.publicKey);
  const state = afterInfo.data[66];
  console.log("[7] State after freeze:");
  console.log(`   AccountState byte: ${state}`);
  console.log(`   Result: ${state === 2 ? '✓ FROZEN' : '❌ NOT FROZEN'}`);
}

main().catch(console.error);