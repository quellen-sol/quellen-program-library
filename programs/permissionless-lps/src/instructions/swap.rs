use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::{
    error::LpsError,
    events::SwapEvent,
    seeds::POOL_SEED,
    state::pool::LiquidityPool,
};

#[derive(Accounts)]
#[instruction(amount_in: u64, minimum_amount_out: u64)]
pub struct Swap<'info> {
    #[account(mut, token::authority = user)]
    pub user_token_account_in: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::authority = user)]
    pub user_token_account_out: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account()]
    pub user: Signer<'info>,

    #[account(
        mut,
        has_one = mint_a @ LpsError::InvalidMintA,
        has_one = mint_b @ LpsError::InvalidMintB,
    )]
    pub pool: Box<Account<'info, LiquidityPool>>,

    #[account()]
    pub mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account()]
    pub mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub pool_token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub pool_token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_swap(
    ctx: Context<Swap>,
    amount_in: u64,
    minimum_amount_out: u64,
) -> Result<()> {
    require!(amount_in > 0, LpsError::ZeroSwapAmount);

    let reserve_a = ctx.accounts.pool_token_account_a.amount;
    let reserve_b = ctx.accounts.pool_token_account_b.amount;
    let fee_bps = ctx.accounts.pool.fee_bps;
    let mint_a_key = ctx.accounts.mint_a.key();
    let mint_b_key = ctx.accounts.mint_b.key();
    let pool_bump = ctx.accounts.pool.pool_bump;

    // Determine swap direction
    let user_in_mint = ctx.accounts.user_token_account_in.mint;
    let a_to_b = user_in_mint == ctx.accounts.mint_a.key();

    let (reserve_in, reserve_out, mint_in_decimals, mint_out_decimals) = if a_to_b {
        (reserve_a, reserve_b, ctx.accounts.mint_a.decimals, ctx.accounts.mint_b.decimals)
    } else {
        (reserve_b, reserve_a, ctx.accounts.mint_b.decimals, ctx.accounts.mint_a.decimals)
    };

    // Constant product swap with fee: amount_out = reserve_out * amount_in_after_fee / (reserve_in + amount_in_after_fee)
    let fee = (amount_in as u128)
        .checked_mul(fee_bps as u128)
        .unwrap()
        .checked_div(10000)
        .unwrap();
    let amount_in_after_fee = (amount_in as u128).checked_sub(fee).unwrap();

    let amount_out: u64 = (reserve_out as u128)
        .checked_mul(amount_in_after_fee)
        .unwrap()
        .checked_div(
            (reserve_in as u128)
                .checked_add(amount_in_after_fee)
                .unwrap(),
        )
        .unwrap()
        .try_into()
        .unwrap();

    require!(amount_out >= minimum_amount_out, LpsError::InsufficientOutputAmount);

    // Transfer input tokens from user to pool
    let (pool_account_in, pool_account_out, mint_in_info, mint_out_info) = if a_to_b {
        (
            ctx.accounts.pool_token_account_a.to_account_info(),
            ctx.accounts.pool_token_account_b.to_account_info(),
            ctx.accounts.mint_a.to_account_info(),
            ctx.accounts.mint_b.to_account_info(),
        )
    } else {
        (
            ctx.accounts.pool_token_account_b.to_account_info(),
            ctx.accounts.pool_token_account_a.to_account_info(),
            ctx.accounts.mint_b.to_account_info(),
            ctx.accounts.mint_a.to_account_info(),
        )
    };

    let txfer_in_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_interface::TransferChecked {
            authority: ctx.accounts.user.to_account_info(),
            from: ctx.accounts.user_token_account_in.to_account_info(),
            mint: mint_in_info,
            to: pool_account_in,
        },
    );
    token_interface::transfer_checked(txfer_in_ctx, amount_in, mint_in_decimals)?;

    // Transfer output tokens from pool to user
    let seeds = &[
        POOL_SEED.as_bytes(),
        mint_a_key.as_ref(),
        mint_b_key.as_ref(),
        &[pool_bump],
    ];
    let pool_signer = &[&seeds[..]];
    let txfer_out_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::TransferChecked {
            authority: ctx.accounts.pool.to_account_info(),
            from: pool_account_out,
            mint: mint_out_info,
            to: ctx.accounts.user_token_account_out.to_account_info(),
        },
        pool_signer,
    );
    token_interface::transfer_checked(txfer_out_ctx, amount_out, mint_out_decimals)?;

    emit!(SwapEvent {
        pool: ctx.accounts.pool.key(),
        user: ctx.accounts.user.key(),
        amount_in,
        amount_out,
        fee: fee.try_into().unwrap(),
    });

    Ok(())
}
