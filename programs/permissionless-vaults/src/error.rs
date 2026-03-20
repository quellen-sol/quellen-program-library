use anchor_lang::prelude::*;

#[error_code]
pub enum VaultsError {
    #[msg("Authority provided is not the authority of this vault")]
    InvalidAuthority,

    #[msg("Invalid shares_mint for vault")]
    InvalidSharesMint,

    #[msg("Invalid underlying_mint for vault")]
    InvalidUnderlyingMint,
}
