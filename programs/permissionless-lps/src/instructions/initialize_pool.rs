use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    error::LpsError,
    seeds::{LP_MINT_SEED, POOL_SEED, POOL_TOKEN_ACCOUNT_A_SEED, POOL_TOKEN_ACCOUNT_B_SEED},
    state::pool::LiquidityPool,
};

#[derive(Accounts)]
#[instruction(fee_bps: u16)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account()]
    pub mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account()]
    pub mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        space = LiquidityPool::SIZE,
        seeds = [
            POOL_SEED.as_bytes(),
            mint_a.key().as_ref(),
            mint_b.key().as_ref(),
        ],
        bump
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    #[account(
        init,
        payer = authority,
        mint::authority = pool.key(),
        mint::decimals = 9,
        mint::freeze_authority = pool.key(),
        seeds = [
            LP_MINT_SEED.as_bytes(),
            pool.key().as_ref(),
        ],
        bump
    )]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = authority,
        token::authority = pool,
        token::mint = mint_a,
        seeds = [
            POOL_TOKEN_ACCOUNT_A_SEED.as_bytes(),
            pool.key().as_ref(),
        ],
        bump
    )]
    pub pool_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = authority,
        token::authority = pool,
        token::mint = mint_b,
        seeds = [
            POOL_TOKEN_ACCOUNT_B_SEED.as_bytes(),
            pool.key().as_ref(),
        ],
        bump
    )]
    pub pool_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_pool(ctx: Context<InitializePool>, fee_bps: u16) -> Result<()> {
    require!(
        ctx.accounts.mint_a.key() != ctx.accounts.mint_b.key(),
        LpsError::IdenticalMints
    );
    require!(fee_bps < 10000, LpsError::InvalidFeeBps);

    let pool = ctx.accounts.pool.as_mut();
    pool.mint_a = ctx.accounts.mint_a.key();
    pool.mint_b = ctx.accounts.mint_b.key();
    pool.lp_mint = ctx.accounts.lp_mint.key();
    pool.pool_token_account_a = ctx.accounts.pool_token_account_a.key();
    pool.pool_token_account_b = ctx.accounts.pool_token_account_b.key();
    pool.authority = ctx.accounts.authority.key();
    pool.fee_bps = fee_bps;

    pool.pool_bump = ctx.bumps.pool;
    pool.lp_mint_bump = ctx.bumps.lp_mint;
    pool.pool_token_account_a_bump = ctx.bumps.pool_token_account_a;
    pool.pool_token_account_b_bump = ctx.bumps.pool_token_account_b;

    Ok(())
}
