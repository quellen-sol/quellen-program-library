use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::{
    error::LpsError,
    events::AddLiquidityEvent,
    seeds::POOL_SEED,
    state::pool::LiquidityPool,
};

#[derive(Accounts)]
#[instruction(amount_a: u64, amount_b: u64)]
pub struct AddLiquidity<'info> {
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

pub fn handle_add_liquidity(
    ctx: Context<AddLiquidity>,
    amount_a: u64,
    amount_b: u64,
) -> Result<()> {
    require!(amount_a > 0 && amount_b > 0, LpsError::ZeroLiquidityAmount);

    let reserve_a = ctx.accounts.pool_token_account_a.amount;
    let reserve_b = ctx.accounts.pool_token_account_b.amount;
    let lp_supply = ctx.accounts.lp_mint.supply;
    let mint_a_key = ctx.accounts.mint_a.key();
    let mint_b_key = ctx.accounts.mint_b.key();
    let pool_bump = ctx.accounts.pool.pool_bump;

    // Transfer token A from user to pool
    let txfer_a_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_interface::TransferChecked {
            authority: ctx.accounts.user.to_account_info(),
            from: ctx.accounts.user_token_account_a.to_account_info(),
            mint: ctx.accounts.mint_a.to_account_info(),
            to: ctx.accounts.pool_token_account_a.to_account_info(),
        },
    );
    token_interface::transfer_checked(txfer_a_ctx, amount_a, ctx.accounts.mint_a.decimals)?;

    // Transfer token B from user to pool
    let txfer_b_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_interface::TransferChecked {
            authority: ctx.accounts.user.to_account_info(),
            from: ctx.accounts.user_token_account_b.to_account_info(),
            mint: ctx.accounts.mint_b.to_account_info(),
            to: ctx.accounts.pool_token_account_b.to_account_info(),
        },
    );
    token_interface::transfer_checked(txfer_b_ctx, amount_b, ctx.accounts.mint_b.decimals)?;

    // Calculate LP tokens to mint
    let lp_tokens_to_mint: u64 = if lp_supply == 0 {
        // Initial liquidity: sqrt(amount_a * amount_b)
        integer_sqrt(
            (amount_a as u128)
                .checked_mul(amount_b as u128)
                .unwrap(),
        )
        .try_into()
        .unwrap()
    } else {
        // Proportional: min(amount_a * supply / reserve_a, amount_b * supply / reserve_b)
        let lp_for_a = (amount_a as u128)
            .checked_mul(lp_supply as u128)
            .unwrap()
            .checked_div(reserve_a as u128)
            .unwrap();
        let lp_for_b = (amount_b as u128)
            .checked_mul(lp_supply as u128)
            .unwrap()
            .checked_div(reserve_b as u128)
            .unwrap();
        std::cmp::min(lp_for_a, lp_for_b).try_into().unwrap()
    };

    // Mint LP tokens to user
    let seeds = &[
        POOL_SEED.as_bytes(),
        mint_a_key.as_ref(),
        mint_b_key.as_ref(),
        &[pool_bump],
    ];
    let pool_signer = &[&seeds[..]];
    let mint_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::MintTo {
            authority: ctx.accounts.pool.to_account_info(),
            mint: ctx.accounts.lp_mint.to_account_info(),
            to: ctx.accounts.user_lp_token_account.to_account_info(),
        },
        pool_signer,
    );
    token_interface::mint_to(mint_cpi_ctx, lp_tokens_to_mint)?;

    emit!(AddLiquidityEvent {
        pool: ctx.accounts.pool.key(),
        user: ctx.accounts.user.key(),
        amount_a,
        amount_b,
        lp_tokens_minted: lp_tokens_to_mint,
    });

    Ok(())
}

fn integer_sqrt(value: u128) -> u128 {
    if value == 0 {
        return 0;
    }
    let mut x = value;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + value / x) / 2;
    }
    x
}
