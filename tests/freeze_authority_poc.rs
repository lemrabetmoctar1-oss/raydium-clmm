use litesvm::LiteSVM;
use solana_sdk::{
    signature::{Keypair, Signer},
    pubkey::Pubkey,
    transaction::Transaction,
    instruction::{Instruction, AccountMeta},
    system_instruction,
};
use spl_token_2022::{
    id as token_2022_id,
    instruction as token_2022_instruction,
    state::Mint,
};

const CLMM_PROGRAM_SO: &str = "target/deploy/raydium_amm_v3.so";

#[test]
fn freeze_authority_locks_vault_permanently() {
    let mut svm = LiteSVM::new();

    let program_bytes = std::fs::read(CLMM_PROGRAM_SO)
        .expect("Build the program first: run `anchor build`, then re-run this test");
    let clmm_program_id = Pubkey::new_unique();
    svm.add_program(clmm_program_id, &program_bytes);

    let attacker = Keypair::new();
    let victim = Keypair::new();
    let payer = Keypair::new();

    for kp in [&attacker, &victim, &payer] {
        svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
    }

    // --- Step 1: Create Token-2022 mint with freeze_authority = attacker ---
    let mint = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(Mint::LEN);

    let create_mint_account_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        Mint::LEN as u64,
        &token_2022_id(),
    );

    let init_mint_ix = token_2022_instruction::initialize_mint2(
        &token_2022_id(),
        &mint.pubkey(),
        &payer.pubkey(),           // mint authority
        Some(&attacker.pubkey()),  // freeze authority = attacker
        9,
    ).unwrap();

    let tx = Transaction::new_signed_with_payer(
        &[create_mint_account_ix, init_mint_ix],
        Some(&payer.pubkey()),
        &[&payer, &mint],
        svm.latest_blockhash(),
    );
    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Mint creation with freeze_authority failed: {:?}", result);
    println!("[STEP 1] PASS: Token-2022 mint created with freeze_authority = attacker");

    // --- Steps 2-9 are intentionally left as TODOs ---
    // We need the ACTUAL create_pool / increase_liquidity / decrease_liquidity
    // instruction builders matching this program's real account layout and
    // discriminators. Rather than guess these blind, we'll fill them in from
    // the real compiler/runtime errors this first version produces.

    println!("Scaffold PASSED up through mint creation. Next: create_pool call.");
}
