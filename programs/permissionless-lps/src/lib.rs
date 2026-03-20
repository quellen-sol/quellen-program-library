use crate::instructions::*;
use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod seeds;
pub mod state;

declare_id!("31fPCYPHVvggaGvfyWhiUASY4LDwefT5ZEhUtCHN4nC8");

#[program]
pub mod permissionless_lps {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>, fee_bps: u16) -> Result<()> {
        handle_initialize_pool(ctx, fee_bps)
    }

    pub fn add_liquidity(ctx: Context<AddLiquidity>, amount_a: u64, amount_b: u64) -> Result<()> {
        handle_add_liquidity(ctx, amount_a, amount_b)
    }

    pub fn remove_liquidity(ctx: Context<RemoveLiquidity>, lp_amount: u64) -> Result<()> {
        handle_remove_liquidity(ctx, lp_amount)
    }

    pub fn swap(ctx: Context<Swap>, amount_in: u64, minimum_amount_out: u64) -> Result<()> {
        handle_swap(ctx, amount_in, minimum_amount_out)
    }
}
