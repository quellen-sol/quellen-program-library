use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    seeds::{SHARES_SEED, VAULT_SEED, VAULT_TOKEN_ACCOUNT_SEED},
    state::vault::Vault,
};

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account()]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        mint::authority = vault.key(),
        mint::decimals = underlying_mint.decimals,
        mint::freeze_authority = vault.key(),
        seeds = [
            SHARES_SEED.as_bytes(),
            vault.key().as_ref(),
        ],
        bump
    )]
    pub shares_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        space = Vault::SIZE,
        seeds = [
            VAULT_SEED.as_bytes(),
            authority.key().as_ref(),
            underlying_mint.key().as_ref(),
        ],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = authority,
        token::authority = vault,
        token::mint = underlying_mint,
        seeds = [
            VAULT_TOKEN_ACCOUNT_SEED.as_bytes(),
            vault.key().as_ref(),
        ],
        bump
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
    let vault = ctx.accounts.vault.as_mut();
    vault.underlying_mint = ctx.accounts.underlying_mint.key();
    vault.shares_mint = ctx.accounts.shares_mint.key();
    vault.authority = ctx.accounts.authority.key();
    vault.vault_token_account = ctx.accounts.vault_token_account.key();

    vault.shares_mint_bump = ctx.bumps.shares_mint;
    vault.vault_bump = ctx.bumps.vault;
    vault.vault_token_account_bump = ctx.bumps.vault_token_account;

    Ok(())
}
