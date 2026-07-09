# Minimal CLMM freeze exploit proof
# Uses raw transaction instructions, no Anchor IDL needed

import subprocess, time, json, hashlib

# Compute Anchor discriminator
def disc(fn):
    return hashlib.sha256(f"global:{fn}".encode()).digest()[:8]

print("CLMM Instruction discriminators:")
for fn in ["create_pool", "open_position", "increase_liquidity",
           "decrease_liquidity", "close_position", "create_amm_config"]:
    print(f"  {fn}: {disc(fn).hex()}")

# Check if validator is running
result = subprocess.run(['curl', '-s', 'http://127.0.0.1:8899', '-X', 'POST',
                       '-H', 'Content-Type: application/json',
                       '-d', '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'],
                       capture_output=True, text=True)
if 'ok' not in result.stdout:
    print("Starting validator...")
    subprocess.run(['pkill', '-f', 'solana-test-validator'], capture_output=True)
    time.sleep(1)
    subprocess.Popen(['solana-test-validator', '--reset', '--quiet'],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(8)
    result = subprocess.run(['curl', '-s', 'http://127.0.0.1:8899', '-X', 'POST',
                           '-H', 'Content-Type: application/json',
                           '-d', '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'],
                           capture_output=True, text=True)
    print(f"Validator: {'Running' if 'ok' in result.stdout else 'FAILED'}")

# Deploy CLMM
CLMM_SO = "/Users/walata/raydium-audit/raydium-clmm/target/sbpf-solana-solana/release/raydium_clmm.so"
result = subprocess.run(['solana', 'program', 'deploy', CLMM_SO, '--output', 'json'],
                       capture_output=True, text=True, timeout=30)
if result.returncode == 0:
    clmm_id = json.loads(result.stdout)['programId']
    print(f"\nCLMM deployed at: {clmm_id}")
else:
    print(f"Deploy error: {result.stderr}")
    clmm_id = "UNKNOWN"

print(f"\nTo run the complete JS proof, execute:")
print(f"  node tests/proof-classic-token.js")
print(f"\nCLMM program ID to use: {clmm_id}")