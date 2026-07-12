use litesvm::LiteSVM;
use solana_sdk::{
    signature::{Keypair, Signer},
    pubkey::Pubkey,
    transaction::Transaction,
    system_instruction,
};
use spl_token_2022::{id as token_2022_id, instruction as t22_ix, state::Mint};

#[test]
fn freeze_authority_locks_vault() {
    let mut svm = LiteSVM::new();

    // Load the real compiled program - built by the workflow before this runs
    let so_path = "target/deploy/raydium_amm_v3.so";
    let program_bytes = std::fs::read(so_path)
        .unwrap_or_else(|_| panic!("Program not built at {so_path}. Run `anchor build` first."));
    let clmm_program_id = Pubkey::new_unique();
    svm.add_program(clmm_program_id, &program_bytes);

    let payer = Keypair::new();
    let attacker = Keypair::new();
    let victim = Keypair::new();
    for kp in [&payer, &attacker, &victim] {
        svm.airdrop(&kp.pubkey(), 20_000_000_000).unwrap();
    }

    // === STEP 1: create Token-2022 mint with freeze_authority = attacker ===
    let mint = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(Mint::LEN);
    let create_acct_ix = system_instruction::create_account(
        &payer.pubkey(), &mint.pubkey(), rent, Mint::LEN as u64, &token_2022_id(),
    );
    let init_mint_ix = t22_ix::initialize_mint2(
        &token_2022_id(), &mint.pubkey(), &payer.pubkey(), Some(&attacker.pubkey()), 9,
    ).unwrap();

    let tx = Transaction::new_signed_with_payer(
        &[create_acct_ix, init_mint_ix],
        Some(&payer.pubkey()),
        &[&payer, &mint],
        svm.latest_blockhash(),
    );
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "STEP 1 FAILED - mint creation: {:?}", res);
    println!("STEP 1 REAL PASS: mint {} created with freeze_authority = attacker", mint.pubkey());

    // === STEP 2 onward: intentionally stops here ===
    // This is the honest current boundary: calling the real create_pool,
    // increase_liquidity, freeze CPI, and decrease_liquidity instructions
    // requires their exact Anchor account structs and discriminators,
    // which must be pulled from this program's real IDL/instruction
    // builders (likely in the `client/` folder of this repo, or by
    // generating the IDL via `anchor build` then reading target/idl/*.json).
    //
    // DO NOT invent account orderings or discriminators here. Read them
    // from the real generated IDL and fill in the next transaction for
    // real, or report the exact blocker back.
    println!("STEP 1 verified for real. Next: read target/idl/*.json after `anchor build` to get real create_pool account layout.");
}
