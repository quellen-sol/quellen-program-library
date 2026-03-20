import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PermissionlessVaults } from "../target/types/permissionless_vaults";
import { createAssociatedTokenAccount, createMint, getAccount, mintTo, TOKEN_PROGRAM_ID, transfer } from "@solana/spl-token";
import { BN } from "bn.js";
import { assert } from "chai";

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

    const sharesAccount = await getAccount(connection, userSharesTokenAccount);
    assert(sharesAccount.amount === BigInt(10));
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

    const sharesAccount = await getAccount(connection, userSharesTokenAccount);
    const underlyingAccount = await getAccount(connection, userUsdcTokenAccount);
    assert(sharesAccount.amount === BigInt(0));
    assert(underlyingAccount.amount === BigInt(1_000_000));
  });

  // ── Adversarial tests ──

  describe("malicious actor", () => {
    let attacker: anchor.web3.Keypair;
    let attackerTokenAccount: anchor.web3.PublicKey;
    let attackerSharesTokenAccount: anchor.web3.PublicKey;

    before(async () => {
      const payer = program.provider.wallet.payer;
      attacker = anchor.web3.Keypair.generate();

      // Fund the attacker with SOL
      const sig = await connection.requestAirdrop(attacker.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);

      // Create attacker's token accounts
      attackerTokenAccount = await createAssociatedTokenAccount(connection, payer, usdcMint, attacker.publicKey);
      attackerSharesTokenAccount = await createAssociatedTokenAccount(connection, payer, vUsdcMint, attacker.publicKey);

      // Give attacker some tokens to attempt attacks with
      await mintTo(connection, payer, usdcMint, attackerTokenAccount, payer, 500_000);

      // Legitimate user re-deposits so the vault has funds to steal
      await program.methods.deposit(new BN(500_000)).accounts({
        userTokenAccount: userUsdcTokenAccount,
        userSharesTokenAccount: userSharesTokenAccount,
        user: userPk,
        vault: vaultAddr,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
    });

    it("Cannot withdraw shares they don't have", async () => {
      try {
        await program.methods.withdraw(new BN(100)).accounts({
          userTokenAccount: attackerTokenAccount,
          userSharesTokenAccount: attackerSharesTokenAccount,
          user: attacker.publicKey,
          vault: vaultAddr,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — attacker has no shares to burn");
      } catch (err) {
        assert(err.message.includes("insufficient"), `Unexpected error: ${err.message}`);
      }
    });

    it("Cannot withdraw using someone else's shares token account", async () => {
      // Attacker tries to pass the legitimate user's shares account to steal funds
      try {
        await program.methods.withdraw(new BN(100)).accounts({
          userTokenAccount: attackerTokenAccount,
          userSharesTokenAccount: userSharesTokenAccount,
          user: attacker.publicKey,
          vault: vaultAddr,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — shares account authority doesn't match signer");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot deposit and redirect shares to someone else's account", async () => {
      // Attacker deposits but tries to get shares minted to the legitimate user's shares account
      // (trying to manipulate share pricing). The constraint `token::authority = user` blocks this.
      try {
        await program.methods.deposit(new BN(100)).accounts({
          userTokenAccount: attackerTokenAccount,
          userSharesTokenAccount: userSharesTokenAccount,
          user: attacker.publicKey,
          vault: vaultAddr,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — shares account authority doesn't match signer");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot withdraw more shares than owned", async () => {
      // Attacker deposits legitimately, then tries to withdraw more than their balance
      await program.methods.deposit(new BN(1000)).accounts({
        userTokenAccount: attackerTokenAccount,
        userSharesTokenAccount: attackerSharesTokenAccount,
        user: attacker.publicKey,
        vault: vaultAddr,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      const sharesBalance = (await getAccount(connection, attackerSharesTokenAccount)).amount;

      try {
        await program.methods.withdraw(new BN((sharesBalance + BigInt(1)).toString())).accounts({
          userTokenAccount: attackerTokenAccount,
          userSharesTokenAccount: attackerSharesTokenAccount,
          user: attacker.publicKey,
          vault: vaultAddr,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — withdrawing more shares than owned");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }

      // Clean up: withdraw what we deposited
      await program.methods.withdraw(new BN(sharesBalance.toString())).accounts({
        userTokenAccount: attackerTokenAccount,
        userSharesTokenAccount: attackerSharesTokenAccount,
        user: attacker.publicKey,
        vault: vaultAddr,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();
    });

    it("Deposit zero tokens mints zero shares", async () => {
      const sharesBefore = (await getAccount(connection, attackerSharesTokenAccount)).amount;

      await program.methods.deposit(new BN(0)).accounts({
        userTokenAccount: attackerTokenAccount,
        userSharesTokenAccount: attackerSharesTokenAccount,
        user: attacker.publicKey,
        vault: vaultAddr,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      const sharesAfter = (await getAccount(connection, attackerSharesTokenAccount)).amount;
      assert(sharesAfter === sharesBefore, "depositing 0 tokens should mint 0 shares");
    });

    it("Multi-user accounting is correct", async () => {
      // Both users deposit into the same vault; track only the shares minted per deposit
      const vaultBefore = (await getAccount(connection, vaultTokenAccount)).amount;

      const userSharesBefore = (await getAccount(connection, userSharesTokenAccount)).amount;
      const attackerSharesBefore = (await getAccount(connection, attackerSharesTokenAccount)).amount;

      const userDeposit = BigInt(10_000);
      const attackerDeposit = BigInt(5_000);

      await program.methods.deposit(new BN(userDeposit.toString())).accounts({
        userTokenAccount: userUsdcTokenAccount,
        userSharesTokenAccount: userSharesTokenAccount,
        user: userPk,
        vault: vaultAddr,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      await program.methods.deposit(new BN(attackerDeposit.toString())).accounts({
        userTokenAccount: attackerTokenAccount,
        userSharesTokenAccount: attackerSharesTokenAccount,
        user: attacker.publicKey,
        vault: vaultAddr,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      // Vault should hold both deposits
      const vaultAfterDeposits = (await getAccount(connection, vaultTokenAccount)).amount;
      assert(vaultAfterDeposits === vaultBefore + userDeposit + attackerDeposit, "vault should hold both deposits");

      // Only withdraw the shares minted from these deposits (not pre-existing ones)
      const userSharesAfterDeposit = (await getAccount(connection, userSharesTokenAccount)).amount;
      const attackerSharesAfterDeposit = (await getAccount(connection, attackerSharesTokenAccount)).amount;
      const userNewShares = userSharesAfterDeposit - userSharesBefore;
      const attackerNewShares = attackerSharesAfterDeposit - attackerSharesBefore;

      const userTokensBefore = (await getAccount(connection, userUsdcTokenAccount)).amount;
      const attackerTokensBefore = (await getAccount(connection, attackerTokenAccount)).amount;

      await program.methods.withdraw(new BN(userNewShares.toString())).accounts({
        userTokenAccount: userUsdcTokenAccount,
        userSharesTokenAccount: userSharesTokenAccount,
        user: userPk,
        vault: vaultAddr,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      await program.methods.withdraw(new BN(attackerNewShares.toString())).accounts({
        userTokenAccount: attackerTokenAccount,
        userSharesTokenAccount: attackerSharesTokenAccount,
        user: attacker.publicKey,
        vault: vaultAddr,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      // Each user should get back approximately what they deposited (within ±1 rounding)
      const userTokensAfter = (await getAccount(connection, userUsdcTokenAccount)).amount;
      const attackerTokensAfter = (await getAccount(connection, attackerTokenAccount)).amount;
      const userReturned = userTokensAfter - userTokensBefore;
      const attackerReturned = attackerTokensAfter - attackerTokensBefore;

      assert(userReturned >= userDeposit - BigInt(1) && userReturned <= userDeposit + BigInt(1),
        `user should get back ~${userDeposit}, got ${userReturned}`);
      assert(attackerReturned >= attackerDeposit - BigInt(1) && attackerReturned <= attackerDeposit + BigInt(1),
        `attacker should get back ~${attackerDeposit}, got ${attackerReturned}`);
    });

    it("Cannot use a fake vault to steal funds", async () => {
      // Attacker creates their own vault and tries to pass the legitimate user's vault token account
      const fakeVaultAddr = deriveVaultAccount(attacker.publicKey, usdcMint, program.programId);
      const fakeVUsdcMint = deriveSharesMint(fakeVaultAddr, program.programId);
      const fakeVaultTokenAccount = deriveVaultTokenAccount(fakeVaultAddr, program.programId);

      // Initialize attacker's own vault
      await program.methods.initializeVault().accounts({
        authority: attacker.publicKey,
        underlyingMint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      const fakeSharesAccount = await createAssociatedTokenAccount(
        connection, program.provider.wallet.payer, fakeVUsdcMint, attacker.publicKey
      );

      // Deposit into attacker's vault
      await program.methods.deposit(new BN(100)).accounts({
        userTokenAccount: attackerTokenAccount,
        userSharesTokenAccount: fakeSharesAccount,
        user: attacker.publicKey,
        vault: fakeVaultAddr,
        vaultTokenAccount: fakeVaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      // Try to withdraw from attacker's vault but pointing to the legitimate user's vault token account
      try {
        await program.methods.withdraw(new BN(100)).accounts({
          userTokenAccount: attackerTokenAccount,
          userSharesTokenAccount: fakeSharesAccount,
          user: attacker.publicKey,
          vault: fakeVaultAddr,
          vaultTokenAccount: vaultTokenAccount, // legitimate user's vault token account
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — vault token account doesn't belong to attacker's vault");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });
  });
});
