use crate::instructions::*;
use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod seeds;
pub mod state;

declare_id!("8VKhpNxnGM4Sh2tfMcbvaZu7AFsrLSNSSrE8KXyzsa7f");

#[program]
pub mod permissionless_vaults {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        handle_initialize_vault(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        handle_withdraw(ctx, amount)
    }
}
