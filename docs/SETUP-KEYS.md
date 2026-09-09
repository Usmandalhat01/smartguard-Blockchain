# Obtaining the credentials

Four things are needed before the blockchain layer can be deployed and the
experiment can be run against real data. None of them cost money.

Work through these in order. The whole sequence takes about 30 minutes, most of
it waiting for a faucet.

---

## 1 · Two Ethereum accounts

You need two, not one. The deployer owns the contracts; the oracle operator
signs risk-score writes. Keeping them separate means a compromised relay is not
a compromised owner — which is the point of `setOracleOperator` existing at all
(Section 3.15.2).

### Install MetaMask

1. Go to <https://metamask.io/download> and install the browser extension.
2. Create a wallet. **Write the twelve-word recovery phrase on paper.** If you
   lose it the accounts are gone; there is no reset.
3. This first account is your **deployer**.

### Add a second account

1. Click the account circle at the top right of MetaMask.
2. **Add account or hardware wallet** → **Add a new account**.
3. Name it `SmartGuard oracle`. This is your **oracle operator**.

### Show the Sepolia test network

1. Click the network dropdown at the top left (it says "Ethereum Mainnet").
2. Toggle **Show test networks** on.
3. Select **Sepolia**.

### Export both private keys

For each of the two accounts, with that account selected:

1. Click the three dots beside the account name → **Account details**.
2. **Show private key**, enter your MetaMask password.
3. Copy the key. It is 64 hexadecimal characters, usually shown with a `0x`
   prefix.

> **These keys control the accounts.** They go in `.env`, which `.gitignore`
> already excludes. Never paste one into a chat, a commit, a screenshot or a
> submitted document. Use these accounts for Sepolia only — never hold real
> value in an account whose key has been in a text file.

---

## 2 · Sepolia test ether

Only the **deployer** needs funding. Roughly 0.05 ETH covers deployment and a
comfortable number of test transactions.

Most faucets require the receiving account to have some mainnet activity, or a
free account with the provider. Try in this order:

| Faucet | Requirement |
| ------ | ----------- |
| <https://www.alchemy.com/faucets/ethereum-sepolia> | Free Alchemy account (you need one anyway — step 3) |
| <https://cloud.google.com/application/web3/faucet/ethereum/sepolia> | Google account |
| <https://faucets.chain.link/sepolia> | GitHub account |
| <https://sepolia-faucet.pk910.de> | Proof-of-work in the browser, no account |

Paste your deployer's **public address** (starts `0x`, safe to share — this is
not the private key). Funds usually arrive within a minute or two.

Confirm it landed: paste the address into <https://sepolia.etherscan.io>.

---

## 3 · An RPC endpoint

Your machine cannot talk to Sepolia directly; it needs a node provider.
**Record which one you use** — correction 17 specifically flagged its absence
from the latency evidence, so it belongs in the report.

### Alchemy (recommended — same account as the faucet above)

1. Sign up at <https://www.alchemy.com>.
2. **Create new app**. Chain **Ethereum**, network **Sepolia**.
3. Open the app → **API key** → copy the **HTTPS** URL.

It looks like `https://eth-sepolia.g.alchemy.com/v2/AbC123…`.

### Infura (equivalent alternative)

1. Sign up at <https://developer.metamask.io>.
2. **Create new API key**, network **Ethereum**.
3. Copy the Sepolia endpoint: `https://sepolia.infura.io/v3/AbC123…`.

The free tier on either is far more than this project consumes.

---

## 4 · An Etherscan API key

This is for `npx hardhat verify`, which publishes your Solidity source next to
the deployed bytecode so anyone can confirm the contract does what the report
says. That is worth having in a submission.

1. Sign up at <https://etherscan.io/register>.
2. **API Keys** in the left sidebar → **Add**.
3. Name it `SmartGuard` and copy the key.

---

## 5 · Fill in `.env`

```bash
cd smartguard
cp .env.example .env
```

Open `.env` and fill in:

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-key-here
DEPLOYER_PRIVATE_KEY=0xyour-deployer-key
ORACLE_PRIVATE_KEY=0xyour-oracle-key
ETHERSCAN_API_KEY=your-etherscan-key
SESSION_SECRET=
```

Generate the session secret with:

```bash
openssl rand -base64 48
```

Paste the output as `SESSION_SECRET`. This one is local to the web application
and has nothing to do with Ethereum, but the presentation layer refuses to run
in production without it.

Confirm `.env` is not tracked:

```bash
git status --short        # .env must NOT appear
```

If it does appear, stop and tell me — the `.gitignore` rule has broken.

---

## 6 · Deploy

Commit first. The deploy script records the commit SHA alongside the contract
addresses, and refuses to claim a clean provenance if the working tree is dirty
— a record pointing at a commit that does not describe the deployed bytecode is
worse than no record.

```bash
git add -A && git commit -m "Prepare for Sepolia deployment"

cd contracts
npx hardhat run scripts/deploy.js --network sepolia
```

This writes `docs/evidence/deployment.sepolia.json` containing every identifier
Appendix A lists as missing: both contract addresses, both deployment
transaction hashes, block numbers, gas used, the compiler version and settings,
the chain id and the commit SHA.

Then publish the source, using the two commands the deploy script prints:

```bash
npx hardhat verify --network sepolia <oracle-address> <operator-address>
npx hardhat verify --network sepolia <escrow-address> <oracle-address> 75 172800 604800
```

Commit the evidence file. It is what turns "reported implemented prototype"
into a claim a reader can check.

---

## 7 · The PaySim dataset

Separate from the credentials above, and needed for the experiment.

1. Create a free Kaggle account at <https://www.kaggle.com>.
2. Go to <https://www.kaggle.com/datasets/ealaxi/paysim1>.
3. **Download** (about 180 MB compressed, 470 MB unpacked).
4. Unzip and place the CSV at:

```
smartguard/ml/data/raw/PS_20174392719_1491204439457_log.csv
```

Or, with the Kaggle CLI:

```bash
pip install kaggle
# Kaggle → Settings → API → Create New Token, saves kaggle.json
mkdir -p ~/.kaggle && mv ~/Downloads/kaggle.json ~/.kaggle/
chmod 600 ~/.kaggle/kaggle.json

kaggle datasets download -d ealaxi/paysim1 -p ml/data/raw --unzip
```

The file is gitignored — 470 MB does not belong in a submission repository, and
the pipeline reconstructs everything from it deterministically.

---

## Checklist

- [ ] MetaMask installed, recovery phrase written down on paper
- [ ] Two accounts created, Sepolia network visible
- [ ] Both private keys exported
- [ ] Deployer funded, balance visible on Sepolia Etherscan
- [ ] RPC URL obtained, **provider name written down for the report**
- [ ] Etherscan API key obtained
- [ ] `.env` filled in, `git status` confirms it is untracked
- [ ] PaySim CSV in `ml/data/raw/`

Tell me when these are done and I will run the deployment and the full
experiment.
