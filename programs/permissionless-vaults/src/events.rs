use anchor_lang::prelude::*;

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub tokens_in: u64,
    pub shares_out: u64,
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_in: u64,
    pub tokens_out: u64,
}
