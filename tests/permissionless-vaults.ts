import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PermissionlessVaults } from "../target/types/permissionless_vaults";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccount, createMint, mintTo, TOKEN_PROGRAM_ID, transfer } from "@solana/spl-token";
import { BN } from "bn.js";
import { assert } from "chai";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";

function deriveVaultAccount(user: anchor.web3.PublicKey, mint: anchor.web3.PublicKey, pid: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault"), user.toBuffer(), mint.toBuffer()], pid)[0]
}

function deriveVaultTokenAccount(vault: anchor.web3.PublicKey, pid: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault_token_account"), vault.toBuffer()], pid)[0]
}

function deriveSharesMint(vault: anchor.web3.PublicKey, pid: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("shares_mint"), vault.toBuffer()], pid)[0]
}

describe("permissionless vaults", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.PermissionlessVaults as Program<PermissionlessVaults>;

  const connection = program.provider.connection;
  let userPk: anchor.web3.PublicKey;
  let usdcMint: anchor.web3.PublicKey;
  let userUsdcTokenAccount: anchor.web3.PublicKey;
  let userSharesTokenAccount: anchor.web3.PublicKey;
  let vUsdcMint: anchor.web3.PublicKey;
  let vaultAddr: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;

  before(async () => {
    const payer = program.provider.wallet.payer;
    userPk = program.provider.wallet.publicKey;
    usdcMint = await createMint(connection, payer, userPk, null, 9);
    userUsdcTokenAccount = await createAssociatedTokenAccount(connection, payer, usdcMint, userPk);
    vaultAddr = deriveVaultAccount(userPk, usdcMint, program.programId);
    vUsdcMint = deriveSharesMint(vaultAddr, program.programId);
    vaultTokenAccount = deriveVaultTokenAccount(vaultAddr, program.programId);

    await mintTo(connection, payer, usdcMint, userUsdcTokenAccount, payer, 1_000_000);
  });

  it("Initializes a vault", async () => {
    await program.methods.initializeVault().accounts({
      authority: userPk,
      underlyingMint: usdcMint,
      // sharesMint: vUsdcMint,
      // vault: vaultAddr,
      // vaultTokenAccount: vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      // system_program: SYSTEM_PROGRAM_ID,
    }).rpc();
  });

  it("User deposits 10 tokens into vault", async () => {
    userSharesTokenAccount = await createAssociatedTokenAccount(connection, program.provider.wallet.payer, vUsdcMint, userPk);

    await program.methods.deposit(new BN(10)).accounts({
      userTokenAccount: userUsdcTokenAccount,
      userSharesTokenAccount: userSharesTokenAccount,
      user: userPk,
      vault: vaultAddr,
      vaultTokenAccount: vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    const sharesATA = await connection.getParsedTokenAccountsByOwner(userPk, {
      mint: vUsdcMint,
      programId: TOKEN_PROGRAM_ID,
    });
    assert(sharesATA.value[0]?.account.data.parsed.info.tokenAmount.amount === "10");
  });

  it("User emits 5 tokens into vault", async () => {
    await transfer(connection, program.provider.wallet.payer, userUsdcTokenAccount, vaultTokenAccount, program.provider.wallet.payer, 5);
  });

  it("User withdraws 10 shares from vault", async () => {
    await program.methods.withdraw(new BN(10)).accounts({
      userTokenAccount: userUsdcTokenAccount,
      userSharesTokenAccount: userSharesTokenAccount,
      user: userPk,
      vault: vaultAddr,
      vaultTokenAccount: vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(userPk, {
      programId: TOKEN_PROGRAM_ID,
    });
    const sharesATA = tokenAccounts.value.find((a) => a.account.data.parsed.info.mint === vUsdcMint.toString());
    const underlyingATA = tokenAccounts.value.find((a) => a.account.data.parsed.info.mint === usdcMint.toString());
    const sharesBalance = Number(sharesATA.account.data.parsed.info.tokenAmount.amount);
    const underlyingBalance = Number(underlyingATA.account.data.parsed.info.tokenAmount.amount);
    assert(sharesBalance === 0);
    assert(underlyingBalance === 1_000_000);
  });
});
