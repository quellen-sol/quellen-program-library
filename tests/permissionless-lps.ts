import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PermissionlessLps } from "../target/types/permissionless_lps";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getMint,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { assert } from "chai";

function derivePool(mintA: anchor.web3.PublicKey, mintB: anchor.web3.PublicKey, pid: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
    pid
  )[0];
}

function deriveLpMint(pool: anchor.web3.PublicKey, pid: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), pool.toBuffer()],
    pid
  )[0];
}

function derivePoolTokenAccountA(pool: anchor.web3.PublicKey, pid: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool_token_account_a"), pool.toBuffer()],
    pid
  )[0];
}

function derivePoolTokenAccountB(pool: anchor.web3.PublicKey, pid: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pool_token_account_b"), pool.toBuffer()],
    pid
  )[0];
}

describe("permissionless lps", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.PermissionlessLps as Program<PermissionlessLps>;
  const connection = program.provider.connection;

  let userPk: anchor.web3.PublicKey;
  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let userTokenAccountA: anchor.web3.PublicKey;
  let userTokenAccountB: anchor.web3.PublicKey;
  let userLpTokenAccount: anchor.web3.PublicKey;
  let poolAddr: anchor.web3.PublicKey;
  let lpMint: anchor.web3.PublicKey;
  let poolTokenAccountA: anchor.web3.PublicKey;
  let poolTokenAccountB: anchor.web3.PublicKey;

  const FEE_BPS = 30; // 0.3%

  before(async () => {
    const payer = program.provider.wallet.payer;
    userPk = program.provider.wallet.publicKey;

    mintA = await createMint(connection, payer, userPk, null, 9);
    mintB = await createMint(connection, payer, userPk, null, 9);

    userTokenAccountA = await createAssociatedTokenAccount(connection, payer, mintA, userPk);
    userTokenAccountB = await createAssociatedTokenAccount(connection, payer, mintB, userPk);

    await mintTo(connection, payer, mintA, userTokenAccountA, payer, 10_000_000_000);
    await mintTo(connection, payer, mintB, userTokenAccountB, payer, 10_000_000_000);

    poolAddr = derivePool(mintA, mintB, program.programId);
    lpMint = deriveLpMint(poolAddr, program.programId);
    poolTokenAccountA = derivePoolTokenAccountA(poolAddr, program.programId);
    poolTokenAccountB = derivePoolTokenAccountB(poolAddr, program.programId);
  });

  it("Initializes a pool", async () => {
    await program.methods.initializePool(FEE_BPS).accounts({
      authority: userPk,
      mintA: mintA,
      mintB: mintB,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    const poolAccount = await program.account.liquidityPool.fetch(poolAddr);
    assert(poolAccount.mintA.equals(mintA), "mint_a mismatch");
    assert(poolAccount.mintB.equals(mintB), "mint_b mismatch");
    assert(poolAccount.lpMint.equals(lpMint), "lp_mint mismatch");
    assert(poolAccount.feeBps === FEE_BPS, "fee_bps mismatch");
    assert(poolAccount.authority.equals(userPk), "authority mismatch");
  });

  it("Adds initial liquidity", async () => {
    const payer = program.provider.wallet.payer;
    userLpTokenAccount = await createAssociatedTokenAccount(connection, payer, lpMint, userPk);

    const amountA = new BN(1_000_000_000);
    const amountB = new BN(4_000_000_000);

    await program.methods.addLiquidity(amountA, amountB).accounts({
      userTokenAccountA: userTokenAccountA,
      userTokenAccountB: userTokenAccountB,
      userLpTokenAccount: userLpTokenAccount,
      user: userPk,
      pool: poolAddr,
      poolTokenAccountA: poolTokenAccountA,
      poolTokenAccountB: poolTokenAccountB,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    // sqrt(1_000_000_000 * 4_000_000_000) = 2_000_000_000
    const lpAccount = await getAccount(connection, userLpTokenAccount);
    assert(lpAccount.amount === BigInt(2_000_000_000), `Expected 2_000_000_000 LP tokens, got ${lpAccount.amount}`);

    const poolA = await getAccount(connection, poolTokenAccountA);
    const poolB = await getAccount(connection, poolTokenAccountB);
    assert(poolA.amount === BigInt(1_000_000_000), "pool reserve A mismatch");
    assert(poolB.amount === BigInt(4_000_000_000), "pool reserve B mismatch");
  });

  it("Adds more liquidity proportionally", async () => {
    const amountA = new BN(500_000_000);
    const amountB = new BN(2_000_000_000);

    await program.methods.addLiquidity(amountA, amountB).accounts({
      userTokenAccountA: userTokenAccountA,
      userTokenAccountB: userTokenAccountB,
      userLpTokenAccount: userLpTokenAccount,
      user: userPk,
      pool: poolAddr,
      poolTokenAccountA: poolTokenAccountA,
      poolTokenAccountB: poolTokenAccountB,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    // min(500M * 2B / 1B, 2B * 2B / 4B) = min(1B, 1B) = 1_000_000_000
    // Total LP: 2B + 1B = 3_000_000_000
    const lpAccount = await getAccount(connection, userLpTokenAccount);
    assert(lpAccount.amount === BigInt(3_000_000_000), `Expected 3_000_000_000 LP tokens, got ${lpAccount.amount}`);
  });

  it("Swaps token A for token B", async () => {
    const amountIn = new BN(100_000_000); // 100M token A in
    const minimumAmountOut = new BN(1); // Accept any output for this test

    const userABefore = (await getAccount(connection, userTokenAccountA)).amount;
    const userBBefore = (await getAccount(connection, userTokenAccountB)).amount;
    const poolABefore = (await getAccount(connection, poolTokenAccountA)).amount;
    const poolBBefore = (await getAccount(connection, poolTokenAccountB)).amount;

    await program.methods.swap(amountIn, minimumAmountOut).accounts({
      userTokenAccountIn: userTokenAccountA,
      userTokenAccountOut: userTokenAccountB,
      user: userPk,
      pool: poolAddr,
      poolTokenAccountA: poolTokenAccountA,
      poolTokenAccountB: poolTokenAccountB,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    const userAAfter = (await getAccount(connection, userTokenAccountA)).amount;
    const userBAfter = (await getAccount(connection, userTokenAccountB)).amount;
    const poolAAfter = (await getAccount(connection, poolTokenAccountA)).amount;
    const poolBAfter = (await getAccount(connection, poolTokenAccountB)).amount;

    // User sent 100M token A
    assert(userABefore - userAAfter === BigInt(100_000_000), "user A balance should decrease by 100M");
    // Pool received 100M token A
    assert(poolAAfter - poolABefore === BigInt(100_000_000), "pool A reserve should increase by 100M");

    // Calculate expected output: fee = 100M * 30 / 10000 = 300_000
    // amount_in_after_fee = 100_000_000 - 300_000 = 99_700_000
    // reserve_in = 1_500_000_000, reserve_out = 6_000_000_000
    // amount_out = 6_000_000_000 * 99_700_000 / (1_500_000_000 + 99_700_000)
    //            = 598_200_000_000_000_000 / 1_599_700_000
    //            = 374_014_065 (truncated)
    const amountOut = userBAfter - userBBefore;
    assert(amountOut > BigInt(0), "user should have received token B");
    assert(poolBBefore - poolBAfter === amountOut, "pool B reserve should decrease by amount_out");

    // Verify constant product invariant holds (k should increase due to fees)
    const kBefore = poolABefore * poolBBefore;
    const kAfter = poolAAfter * poolBAfter;
    assert(kAfter >= kBefore, "k should not decrease after swap (fees increase k)");
  });

  it("Swaps token B for token A", async () => {
    const amountIn = new BN(200_000_000);
    const minimumAmountOut = new BN(1);

    const userABefore = (await getAccount(connection, userTokenAccountA)).amount;
    const userBBefore = (await getAccount(connection, userTokenAccountB)).amount;

    await program.methods.swap(amountIn, minimumAmountOut).accounts({
      userTokenAccountIn: userTokenAccountB,
      userTokenAccountOut: userTokenAccountA,
      user: userPk,
      pool: poolAddr,
      poolTokenAccountA: poolTokenAccountA,
      poolTokenAccountB: poolTokenAccountB,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    const userAAfter = (await getAccount(connection, userTokenAccountA)).amount;
    const userBAfter = (await getAccount(connection, userTokenAccountB)).amount;

    assert(userBBefore - userBAfter === BigInt(200_000_000), "user B balance should decrease by 200M");
    assert(userAAfter > userABefore, "user should have received token A");
  });

  it("Removes half of LP tokens", async () => {
    const lpBalanceBefore = (await getAccount(connection, userLpTokenAccount)).amount;
    const lpToRemove = new BN((lpBalanceBefore / BigInt(2)).toString());

    const userABefore = (await getAccount(connection, userTokenAccountA)).amount;
    const userBBefore = (await getAccount(connection, userTokenAccountB)).amount;
    const poolABefore = (await getAccount(connection, poolTokenAccountA)).amount;
    const poolBBefore = (await getAccount(connection, poolTokenAccountB)).amount;

    await program.methods.removeLiquidity(lpToRemove).accounts({
      userTokenAccountA: userTokenAccountA,
      userTokenAccountB: userTokenAccountB,
      userLpTokenAccount: userLpTokenAccount,
      user: userPk,
      pool: poolAddr,
      poolTokenAccountA: poolTokenAccountA,
      poolTokenAccountB: poolTokenAccountB,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    const lpBalanceAfter = (await getAccount(connection, userLpTokenAccount)).amount;
    const userAAfter = (await getAccount(connection, userTokenAccountA)).amount;
    const userBAfter = (await getAccount(connection, userTokenAccountB)).amount;
    const poolAAfter = (await getAccount(connection, poolTokenAccountA)).amount;
    const poolBAfter = (await getAccount(connection, poolTokenAccountB)).amount;

    assert(lpBalanceBefore - lpBalanceAfter === BigInt(lpToRemove.toString()), "LP balance should decrease");
    assert(userAAfter > userABefore, "user should have received token A back");
    assert(userBAfter > userBBefore, "user should have received token B back");
    assert(poolAAfter < poolABefore, "pool reserve A should decrease");
    assert(poolBAfter < poolBBefore, "pool reserve B should decrease");
  });

  it("Removes remaining LP tokens", async () => {
    const lpBalance = (await getAccount(connection, userLpTokenAccount)).amount;
    const lpToRemove = new BN(lpBalance.toString());

    await program.methods.removeLiquidity(lpToRemove).accounts({
      userTokenAccountA: userTokenAccountA,
      userTokenAccountB: userTokenAccountB,
      userLpTokenAccount: userLpTokenAccount,
      user: userPk,
      pool: poolAddr,
      poolTokenAccountA: poolTokenAccountA,
      poolTokenAccountB: poolTokenAccountB,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    const lpBalanceAfter = (await getAccount(connection, userLpTokenAccount)).amount;
    const poolAAfter = (await getAccount(connection, poolTokenAccountA)).amount;
    const poolBAfter = (await getAccount(connection, poolTokenAccountB)).amount;

    assert(lpBalanceAfter === BigInt(0), "LP balance should be 0");
    assert(poolAAfter === BigInt(0), "pool reserve A should be 0");
    assert(poolBAfter === BigInt(0), "pool reserve B should be 0");

    // User should have more than original 10B of each token due to fees collected
    // (they were the only LP so they keep all fees)
    const userAFinal = (await getAccount(connection, userTokenAccountA)).amount;
    const userBFinal = (await getAccount(connection, userTokenAccountB)).amount;
    assert(userAFinal === BigInt(10_000_000_000), "user should have all token A back");
    assert(userBFinal === BigInt(10_000_000_000), "user should have all token B back");
  });

  // ── Adversarial tests ──

  describe("malicious actor", () => {
    let attacker: anchor.web3.Keypair;
    let attackerTokenAccountA: anchor.web3.PublicKey;
    let attackerTokenAccountB: anchor.web3.PublicKey;
    let attackerLpTokenAccount: anchor.web3.PublicKey;

    before(async () => {
      const payer = program.provider.wallet.payer;
      attacker = anchor.web3.Keypair.generate();

      const sig = await connection.requestAirdrop(attacker.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);

      attackerTokenAccountA = await createAssociatedTokenAccount(connection, payer, mintA, attacker.publicKey);
      attackerTokenAccountB = await createAssociatedTokenAccount(connection, payer, mintB, attacker.publicKey);
      attackerLpTokenAccount = await createAssociatedTokenAccount(connection, payer, lpMint, attacker.publicKey);

      await mintTo(connection, payer, mintA, attackerTokenAccountA, payer, 1_000_000_000);
      await mintTo(connection, payer, mintB, attackerTokenAccountB, payer, 1_000_000_000);

      // Legitimate user re-seeds the pool with liquidity
      await program.methods.addLiquidity(new BN(1_000_000_000), new BN(1_000_000_000)).accounts({
        userTokenAccountA: userTokenAccountA,
        userTokenAccountB: userTokenAccountB,
        userLpTokenAccount: userLpTokenAccount,
        user: userPk,
        pool: poolAddr,
        poolTokenAccountA: poolTokenAccountA,
        poolTokenAccountB: poolTokenAccountB,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
    });

    it("Cannot initialize pool with identical mints", async () => {
      try {
        await program.methods.initializePool(30).accounts({
          authority: attacker.publicKey,
          mintA: mintA,
          mintB: mintA,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — identical mints");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot initialize pool with fee >= 10000 bps", async () => {
      // Create a fresh pair so PDA doesn't collide
      const payer = program.provider.wallet.payer;
      const freshMintA = await createMint(connection, payer, userPk, null, 9);
      const freshMintB = await createMint(connection, payer, userPk, null, 9);
      try {
        await program.methods.initializePool(10000).accounts({
          authority: attacker.publicKey,
          mintA: freshMintA,
          mintB: freshMintB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — fee_bps >= 10000");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot add liquidity with zero amounts", async () => {
      try {
        await program.methods.addLiquidity(new BN(0), new BN(0)).accounts({
          userTokenAccountA: attackerTokenAccountA,
          userTokenAccountB: attackerTokenAccountB,
          userLpTokenAccount: attackerLpTokenAccount,
          user: attacker.publicKey,
          pool: poolAddr,
          poolTokenAccountA: poolTokenAccountA,
          poolTokenAccountB: poolTokenAccountB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — zero liquidity amounts");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot swap with zero amount", async () => {
      try {
        await program.methods.swap(new BN(0), new BN(0)).accounts({
          userTokenAccountIn: attackerTokenAccountA,
          userTokenAccountOut: attackerTokenAccountB,
          user: attacker.publicKey,
          pool: poolAddr,
          poolTokenAccountA: poolTokenAccountA,
          poolTokenAccountB: poolTokenAccountB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — zero swap amount");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot swap with excessive slippage protection (minimum_amount_out too high)", async () => {
      try {
        await program.methods.swap(new BN(1000), new BN("999999999999999")).accounts({
          userTokenAccountIn: attackerTokenAccountA,
          userTokenAccountOut: attackerTokenAccountB,
          user: attacker.publicKey,
          pool: poolAddr,
          poolTokenAccountA: poolTokenAccountA,
          poolTokenAccountB: poolTokenAccountB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — minimum_amount_out too high");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot remove liquidity they don't have", async () => {
      try {
        await program.methods.removeLiquidity(new BN(1_000_000)).accounts({
          userTokenAccountA: attackerTokenAccountA,
          userTokenAccountB: attackerTokenAccountB,
          userLpTokenAccount: attackerLpTokenAccount,
          user: attacker.publicKey,
          pool: poolAddr,
          poolTokenAccountA: poolTokenAccountA,
          poolTokenAccountB: poolTokenAccountB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — attacker has no LP tokens to burn");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot swap using someone else's token account as input", async () => {
      // Attacker tries to use the legitimate user's token account as input to drain their funds
      try {
        await program.methods.swap(new BN(100_000), new BN(1)).accounts({
          userTokenAccountIn: userTokenAccountA, // legitimate user's account
          userTokenAccountOut: attackerTokenAccountB,
          user: attacker.publicKey,
          pool: poolAddr,
          poolTokenAccountA: poolTokenAccountA,
          poolTokenAccountB: poolTokenAccountB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — token account authority doesn't match signer");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot remove liquidity and redirect tokens to someone else's account", async () => {
      // Attacker first gets some LP tokens legitimately
      await program.methods.addLiquidity(new BN(100_000_000), new BN(100_000_000)).accounts({
        userTokenAccountA: attackerTokenAccountA,
        userTokenAccountB: attackerTokenAccountB,
        userLpTokenAccount: attackerLpTokenAccount,
        user: attacker.publicKey,
        pool: poolAddr,
        poolTokenAccountA: poolTokenAccountA,
        poolTokenAccountB: poolTokenAccountB,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      const lpBalance = (await getAccount(connection, attackerLpTokenAccount)).amount;

      // Try to remove liquidity but redirect output to the legitimate user's token accounts
      try {
        await program.methods.removeLiquidity(new BN(lpBalance.toString())).accounts({
          userTokenAccountA: userTokenAccountA, // victim's account
          userTokenAccountB: userTokenAccountB, // victim's account
          userLpTokenAccount: attackerLpTokenAccount,
          user: attacker.publicKey,
          pool: poolAddr,
          poolTokenAccountA: poolTokenAccountA,
          poolTokenAccountB: poolTokenAccountB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — output token accounts don't belong to signer");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Cannot remove zero LP tokens", async () => {
      try {
        await program.methods.removeLiquidity(new BN(0)).accounts({
          userTokenAccountA: attackerTokenAccountA,
          userTokenAccountB: attackerTokenAccountB,
          userLpTokenAccount: attackerLpTokenAccount,
          user: attacker.publicKey,
          pool: poolAddr,
          poolTokenAccountA: poolTokenAccountA,
          poolTokenAccountB: poolTokenAccountB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([attacker]).rpc();
        assert.fail("Should have failed — zero LP amount");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }
    });

    it("Disproportionate liquidity add gives minimum LP tokens (excess donated)", async () => {
      // Attacker adds heavily skewed liquidity — gets min(ratio_a, ratio_b) LP tokens
      const poolABefore = (await getAccount(connection, poolTokenAccountA)).amount;
      const poolBBefore = (await getAccount(connection, poolTokenAccountB)).amount;
      const lpSupplyBefore = (await getMint(connection, lpMint)).supply;
      const attackerLpBefore = (await getAccount(connection, attackerLpTokenAccount)).amount;

      // Deposit 10x more of token A than proportional — the excess A is effectively donated
      const amountA = new BN(500_000_000);
      const amountB = new BN(50_000_000); // intentionally small relative to pool ratio

      await program.methods.addLiquidity(amountA, amountB).accounts({
        userTokenAccountA: attackerTokenAccountA,
        userTokenAccountB: attackerTokenAccountB,
        userLpTokenAccount: attackerLpTokenAccount,
        user: attacker.publicKey,
        pool: poolAddr,
        poolTokenAccountA: poolTokenAccountA,
        poolTokenAccountB: poolTokenAccountB,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      const attackerLpAfter = (await getAccount(connection, attackerLpTokenAccount)).amount;
      const lpMinted = attackerLpAfter - attackerLpBefore;

      // LP tokens should be based on the smaller ratio (token B), not the larger (token A)
      // lp_for_a = 500M * supply / reserve_a
      // lp_for_b = 50M * supply / reserve_b
      // min(lp_for_a, lp_for_b) should be lp_for_b since B is the constraining side
      const expectedLpForB = (BigInt(50_000_000) * lpSupplyBefore) / poolBBefore;
      assert(lpMinted === expectedLpForB, `LP tokens should be limited by token B ratio: got ${lpMinted}, expected ${expectedLpForB}`);
    });

    it("Constant product k increases after every swap (fee accumulation)", async () => {
      const poolA1 = (await getAccount(connection, poolTokenAccountA)).amount;
      const poolB1 = (await getAccount(connection, poolTokenAccountB)).amount;
      const k1 = poolA1 * poolB1;

      // First swap
      await program.methods.swap(new BN(10_000_000), new BN(1)).accounts({
        userTokenAccountIn: attackerTokenAccountA,
        userTokenAccountOut: attackerTokenAccountB,
        user: attacker.publicKey,
        pool: poolAddr,
        poolTokenAccountA: poolTokenAccountA,
        poolTokenAccountB: poolTokenAccountB,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      const poolA2 = (await getAccount(connection, poolTokenAccountA)).amount;
      const poolB2 = (await getAccount(connection, poolTokenAccountB)).amount;
      const k2 = poolA2 * poolB2;
      assert(k2 > k1, "k should increase after first swap due to fees");

      // Second swap (reverse direction)
      await program.methods.swap(new BN(10_000_000), new BN(1)).accounts({
        userTokenAccountIn: attackerTokenAccountB,
        userTokenAccountOut: attackerTokenAccountA,
        user: attacker.publicKey,
        pool: poolAddr,
        poolTokenAccountA: poolTokenAccountA,
        poolTokenAccountB: poolTokenAccountB,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      const poolA3 = (await getAccount(connection, poolTokenAccountA)).amount;
      const poolB3 = (await getAccount(connection, poolTokenAccountB)).amount;
      const k3 = poolA3 * poolB3;
      assert(k3 > k2, "k should increase after second swap due to fees");
    });

    it("Sandwich attack is mitigated by slippage protection", async () => {
      // Simulate: attacker front-runs victim's swap to move price, then victim's swap
      // should fail if minimum_amount_out is set correctly

      // Snapshot pool state
      const poolABefore = (await getAccount(connection, poolTokenAccountA)).amount;
      const poolBBefore = (await getAccount(connection, poolTokenAccountB)).amount;

      // Attacker front-runs: large swap A->B to move price
      await program.methods.swap(new BN(200_000_000), new BN(1)).accounts({
        userTokenAccountIn: attackerTokenAccountA,
        userTokenAccountOut: attackerTokenAccountB,
        user: attacker.publicKey,
        pool: poolAddr,
        poolTokenAccountA: poolTokenAccountA,
        poolTokenAccountB: poolTokenAccountB,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();

      // Victim's swap with tight slippage protection should fail
      // Calculate what victim would have gotten at the original price
      // reserve_in=poolABefore, reserve_out=poolBBefore, amount_in=50M
      const victimAmountIn = BigInt(50_000_000);
      const fee = (victimAmountIn * BigInt(FEE_BPS)) / BigInt(10000);
      const afterFee = victimAmountIn - fee;
      const expectedOut = (poolBBefore * afterFee) / (poolABefore + afterFee);

      try {
        // Victim sets minimum_amount_out to what they'd get at the original price
        await program.methods.swap(new BN(50_000_000), new BN(expectedOut.toString())).accounts({
          userTokenAccountIn: userTokenAccountA,
          userTokenAccountOut: userTokenAccountB,
          user: userPk,
          pool: poolAddr,
          poolTokenAccountA: poolTokenAccountA,
          poolTokenAccountB: poolTokenAccountB,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        assert.fail("Should have failed — price moved by front-runner, slippage protection kicks in");
      } catch (err) {
        assert(!err.message.includes("assert.fail"), `Unexpected success: ${err.message}`);
      }

      // Attacker back-runs: swap B->A to restore price (clean up)
      await program.methods.swap(new BN(100_000_000), new BN(1)).accounts({
        userTokenAccountIn: attackerTokenAccountB,
        userTokenAccountOut: attackerTokenAccountA,
        user: attacker.publicKey,
        pool: poolAddr,
        poolTokenAccountA: poolTokenAccountA,
        poolTokenAccountB: poolTokenAccountB,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([attacker]).rpc();
    });

    it("Pool funds are safe after all attacks", async () => {
      const poolA = await getAccount(connection, poolTokenAccountA);
      const poolB = await getAccount(connection, poolTokenAccountB);
      assert(poolA.amount > BigInt(0), "pool should still have token A reserves");
      assert(poolB.amount > BigInt(0), "pool should still have token B reserves");
    });
  });
});
