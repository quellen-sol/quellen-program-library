use anchor_lang::prelude::*;

#[error_code]
pub enum LpsError {
    #[msg("Invalid mint_a for pool")]
    InvalidMintA,

    #[msg("Invalid mint_b for pool")]
    InvalidMintB,

    #[msg("Invalid lp_mint for pool")]
    InvalidLpMint,

    #[msg("Swap input amount must be greater than zero")]
    ZeroSwapAmount,

    #[msg("Liquidity amount must be greater than zero")]
    ZeroLiquidityAmount,

    #[msg("Insufficient output amount")]
    InsufficientOutputAmount,

    #[msg("Mint A and Mint B must be different")]
    IdenticalMints,

    #[msg("Fee basis points must be less than 10000")]
    InvalidFeeBps,
}
