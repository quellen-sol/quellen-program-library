# QPL

A collection of side-project Solana programs built with [Anchor](https://www.anchor-lang.com/).

## Programs

### Permissionless Vaults

A simple ERC-4626-style token vault program. Anyone can create a vault for a given token mint, deposit tokens in exchange for shares, and redeem shares to withdraw the underlying tokens. Share pricing is proportional to the vault's token balance.

**Instructions:**

- **initialize_vault** — Creates a new vault, its shares mint, and a token account to hold deposits.
- **deposit** — Transfers tokens into the vault and mints proportional shares to the depositor.
- **withdraw** — Burns shares and returns the proportional amount of underlying tokens.

### Permissionless LPs

A constant product (x\*y=k) liquidity pool program. Anyone can create a pool for any pair of tokens with a configurable swap fee. Fees remain in the pool reserves, increasing the value of LP tokens over time.

**Instructions:**

- **initialize_pool** — Creates a new pool with two token mints, an LP mint, pool token accounts, and a fee rate (in basis points).
- **add_liquidity** — Deposits both tokens into the pool and mints proportional LP tokens. Initial liquidity uses sqrt(amount_a \* amount_b).
- **remove_liquidity** — Burns LP tokens and returns proportional amounts of both underlying tokens.
- **swap** — Swaps one token for the other using the constant product formula with a fee deducted from the input. Supports a minimum output amount for slippage protection.

## Development

```bash
anchor build
anchor test
```
