use anchor_lang::prelude::*;

#[account]
pub struct Vault {
    pub underlying_mint: Pubkey,
    pub shares_mint: Pubkey,
    pub authority: Pubkey,
    pub vault_token_account: Pubkey,

    // Bumps
    pub shares_mint_bump: u8,
    pub vault_bump: u8,
    pub vault_token_account_bump: u8,
}

impl Vault {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 1 + 1 + 1;
}
