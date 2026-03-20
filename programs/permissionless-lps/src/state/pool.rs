use anchor_lang::prelude::*;

#[account]
pub struct LiquidityPool {
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub lp_mint: Pubkey,
    pub pool_token_account_a: Pubkey,
    pub pool_token_account_b: Pubkey,
    pub authority: Pubkey,
    pub fee_bps: u16,

    // Bumps
    pub pool_bump: u8,
    pub lp_mint_bump: u8,
    pub pool_token_account_a_bump: u8,
    pub pool_token_account_b_bump: u8,
}

impl LiquidityPool {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 32 + 32 + 2 + 1 + 1 + 1 + 1;
}
