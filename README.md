# QPL

A collection of side-project Solana programs built with [Anchor](https://www.anchor-lang.com/).

## Programs

### Permissionless Vaults

A simple ERC-4626-style token vault program. Anyone can create a vault for a given token mint, deposit tokens in exchange for shares, and redeem shares to withdraw the underlying tokens. Share pricing is proportional to the vault's token balance.

**Instructions:**

- **initialize_vault** — Creates a new vault, its shares mint, and a token account to hold deposits.
- **deposit** — Transfers tokens into the vault and mints proportional shares to the depositor.
- **withdraw** — Burns shares and returns the proportional amount of underlying tokens.

## Development

```bash
anchor build
anchor test
```
