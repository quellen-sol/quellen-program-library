use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::{
    error::LpsError,
    events::RemoveLiquidityEvent,
    seeds::POOL_SEED,
    state::pool::LiquidityPool,
};

#[derive(Accounts)]
#[instruction(lp_amount: u64)]
pub struct RemoveLiquidity<'info> {
    #[account(mut, token::authority = user)]
    pub user_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::authority = user)]
    pub user_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::authority = user)]
    pub user_lp_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account()]
    pub user: Signer<'info>,

    #[account(
        mut,
        has_one = mint_a @ LpsError::InvalidMintA,
        has_one = mint_b @ LpsError::InvalidMintB,
        has_one = lp_mint @ LpsError::InvalidLpMint,
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    #[account()]
    pub mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account()]
    pub mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub pool_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub pool_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_remove_liquidity(ctx: Context<RemoveLiquidity>, lp_amount: u64) -> Result<()> {
    require!(lp_amount > 0, LpsError::ZeroLiquidityAmount);

    let reserve_a = ctx.accounts.pool_token_account_a.amount;
    let reserve_b = ctx.accounts.pool_token_account_b.amount;
    let lp_supply = ctx.accounts.lp_mint.supply;
    let mint_a_key = ctx.accounts.mint_a.key();
    let mint_b_key = ctx.accounts.mint_b.key();
    let pool_bump = ctx.accounts.pool.pool_bump;

    // Calculate token amounts to return
    let amount_a: u64 = (lp_amount as u128)
        .checked_mul(reserve_a as u128)
        .unwrap()
        .checked_div(lp_supply as u128)
        .unwrap()
        .try_into()
        .unwrap();
    let amount_b: u64 = (lp_amount as u128)
        .checked_mul(reserve_b as u128)
        .unwrap()
        .checked_div(lp_supply as u128)
        .unwrap()
        .try_into()
        .unwrap();

    // Burn LP tokens from user
    let burn_cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_interface::Burn {
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.lp_mint.to_account_info(),
            from: ctx.accounts.user_lp_token_account.to_account_info(),
        },
    );
    token_interface::burn(burn_cpi_ctx, lp_amount)?;

    // Transfer token A back to user
    let seeds = &[
        POOL_SEED.as_bytes(),
        mint_a_key.as_ref(),
        mint_b_key.as_ref(),
        &[pool_bump],
    ];
    let pool_signer = &[&seeds[..]];
    let txfer_a_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::TransferChecked {
            authority: ctx.accounts.pool.to_account_info(),
            from: ctx.accounts.pool_token_account_a.to_account_info(),
            mint: ctx.accounts.mint_a.to_account_info(),
            to: ctx.accounts.user_token_account_a.to_account_info(),
        },
        pool_signer,
    );
    token_interface::transfer_checked(txfer_a_ctx, amount_a, ctx.accounts.mint_a.decimals)?;

    // Transfer token B back to user
    let txfer_b_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::TransferChecked {
            authority: ctx.accounts.pool.to_account_info(),
            from: ctx.accounts.pool_token_account_b.to_account_info(),
            mint: ctx.accounts.mint_b.to_account_info(),
            to: ctx.accounts.user_token_account_b.to_account_info(),
        },
        pool_signer,
    );
    token_interface::transfer_checked(txfer_b_ctx, amount_b, ctx.accounts.mint_b.decimals)?;

    emit!(RemoveLiquidityEvent {
        pool: ctx.accounts.pool.key(),
        user: ctx.accounts.user.key(),
        lp_tokens_burned: lp_amount,
        amount_a,
        amount_b,
    });

    Ok(())
}
