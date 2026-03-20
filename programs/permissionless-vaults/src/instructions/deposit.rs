use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::{error::VaultsError, events::DepositEvent, seeds::VAULT_SEED, state::vault::Vault};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut, token::authority = user)]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::authority = user)]
    pub user_shares_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account()]
    pub user: Signer<'info>,

    #[account(
        mut,
        has_one = shares_mint @ VaultsError::InvalidSharesMint,
        has_one = underlying_mint @ VaultsError::InvalidUnderlyingMint,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account()]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub shares_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let shares_supply = ctx.accounts.shares_mint.supply;
    let vault_balance = ctx.accounts.vault_token_account.amount;
    let vault_underlying_mint_key = ctx.accounts.underlying_mint.key();
    let vault_auth_key = ctx.accounts.vault.authority.key();
    let vault_bump = ctx.accounts.vault.vault_bump;

    // Take tokens from user
    let txfer_from_user_cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_interface::TransferChecked {
            authority: ctx.accounts.user.to_account_info(),
            from: ctx.accounts.user_token_account.to_account_info(),
            mint: ctx.accounts.underlying_mint.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
        },
    );
    token_interface::transfer_checked(
        txfer_from_user_cpi_ctx,
        amount,
        ctx.accounts.underlying_mint.decimals,
    )?;

    // Mint shares to user
    let seeds = &[
        VAULT_SEED.as_bytes(),
        vault_auth_key.as_ref(),
        vault_underlying_mint_key.as_ref(),
        &[vault_bump],
    ];
    let mint_signer = &[&seeds[..]];
    let mint_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::MintTo {
            authority: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.shares_mint.to_account_info(),
            to: ctx.accounts.user_shares_token_account.to_account_info(),
        },
        mint_signer,
    );
    let amount_to_mint: u64 = if shares_supply == 0 || vault_balance == 0 {
        // 1:1 ratio for first mint
        amount
    } else {
        (amount as u128)
            .checked_mul(shares_supply as u128)
            .unwrap()
            .checked_div(vault_balance as u128)
            .unwrap()
            .try_into()
            .unwrap()
    };
    token_interface::mint_to(mint_cpi_ctx, amount_to_mint)?;

    emit!(DepositEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.user.key(),
        tokens_in: amount,
        shares_out: amount_to_mint,
    });

    Ok(())
}
