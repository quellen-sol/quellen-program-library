use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface};

use crate::{error::VaultsError, events::WithdrawEvent, seeds::VAULT_SEED, state::vault::Vault};

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Withdraw<'info> {
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

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let shares_supply = ctx.accounts.shares_mint.supply;
    let vault_balance = ctx.accounts.vault_token_account.amount;
    let vault_underlying_mint_key = ctx.accounts.underlying_mint.key();
    let vault_auth_key = ctx.accounts.vault.authority.key();
    let vault_bump = ctx.accounts.vault.vault_bump;

    // Burn shares
    let burn_cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token_interface::Burn {
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.shares_mint.to_account_info(),
            from: ctx.accounts.user_shares_token_account.to_account_info(),
        },
    );
    token_interface::burn(burn_cpi_ctx, amount)?;

    // Give tokens back to user
    let amount_to_return = (amount as u128)
        .checked_mul(vault_balance as u128)
        .unwrap()
        .checked_div(shares_supply as u128)
        .unwrap()
        .try_into()
        .unwrap();

    let seeds = &[
        VAULT_SEED.as_bytes(),
        vault_auth_key.as_ref(),
        vault_underlying_mint_key.as_ref(),
        &[vault_bump],
    ];
    let vault_signer = &[&seeds[..]];
    let txfer_to_user_cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::TransferChecked {
            authority: ctx.accounts.vault.to_account_info(),
            from: ctx.accounts.vault_token_account.to_account_info(),
            mint: ctx.accounts.underlying_mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
        },
        vault_signer,
    );
    token_interface::transfer_checked(
        txfer_to_user_cpi_ctx,
        amount_to_return,
        ctx.accounts.underlying_mint.decimals,
    )?;

    emit!(WithdrawEvent {
        vault: ctx.accounts.vault.key(),
        user: ctx.accounts.user.key(),
        shares_in: amount,
        tokens_out: amount_to_return,
    });

    Ok(())
}
