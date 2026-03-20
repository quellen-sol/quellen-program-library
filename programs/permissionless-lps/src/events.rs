use anchor_lang::prelude::*;

#[event]
pub struct AddLiquidityEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub lp_tokens_minted: u64,
}

#[event]
pub struct RemoveLiquidityEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub lp_tokens_burned: u64,
    pub amount_a: u64,
    pub amount_b: u64,
}

#[event]
pub struct SwapEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee: u64,
}
