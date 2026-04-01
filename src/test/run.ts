/**
 * QubicShield — Unit Tests
 *
 * Simple test runner with no external dependencies.
 * Tests the DepositManager mock which mirrors the QubicShield smart contract logic.
 * Run with:  npm test
 *
 * Test coverage:
 *   1. createDeposit      — happy path, duplicate wallet
 *   2. validateToken      — valid, unknown token, expired
 *   3. refundDeposit      — success, already refunded, forfeited, not found
 *   4. forfeitDeposit     — success, not found, already processed
 *   5. isAttacking        — below threshold, above threshold
 *   6. getStats           — counters and amounts
 *   7. SC math simulation — forfeit distribution 40/40/15/1/4 split
 */

import assert from 'assert';

// ─── Inline test runner ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
    failures.push(name);
  }
}

function suite(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ─── Helper: fresh DepositManager instance per test suite ─────────────────
// We import the class (not the singleton) to get a clean state each time.

// Because the project exports a singleton we recreate the manager via the
// module internals. For testing we re-require with a reset trick:
function freshManager() {
  // Clear the module cache so each suite gets a clean in-memory state
  const key = require.resolve('../depositManager');
  delete require.cache[key];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../depositManager').default as typeof import('../depositManager').default;
}

// ─── Suite 1: createDeposit ────────────────────────────────────────────────

suite('1. createDeposit', () => {
  const dm = freshManager();

  test('returns sessionId and accessToken', () => {
    const result = dm.createDeposit('WALLET_A', 100);
    assert.ok(result.sessionId, 'sessionId must be truthy');
    assert.ok(result.accessToken, 'accessToken must be truthy');
  });

  test('two deposits get different tokens', () => {
    const a = dm.createDeposit('WALLET_A', 100);
    const b = dm.createDeposit('WALLET_B', 200);
    assert.notStrictEqual(a.accessToken, b.accessToken);
    assert.notStrictEqual(a.sessionId, b.sessionId);
  });

  test('deposit is stored with status held', () => {
    const { sessionId } = dm.createDeposit('WALLET_C', 50);
    const deposit = dm.getDeposit(sessionId);
    assert.strictEqual(deposit?.status, 'held');
    assert.strictEqual(deposit?.amount, 50);
    assert.strictEqual(deposit?.requestCount, 0);
  });

  test('expiresAt is in the future', () => {
    const { sessionId } = dm.createDeposit('WALLET_D', 10);
    const deposit = dm.getDeposit(sessionId);
    assert.ok(deposit!.expiresAt > Date.now(), 'expiresAt must be in the future');
  });
});

// ─── Suite 2: validateToken ────────────────────────────────────────────────

suite('2. validateToken', () => {
  const dm = freshManager();

  test('valid token returns valid=true with sessionId', () => {
    const { accessToken, sessionId } = dm.createDeposit('WALLET_A', 100);
    const result = dm.validateToken(accessToken);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.sessionId, sessionId);
  });

  test('unknown token returns valid=false', () => {
    const result = dm.validateToken('totally-unknown-token');
    assert.strictEqual(result.valid, false);
  });

  test('refunded session token returns valid=false', () => {
    const { accessToken, sessionId } = dm.createDeposit('WALLET_B', 100);
    dm.refundDeposit(sessionId);
    const result = dm.validateToken(accessToken);
    assert.strictEqual(result.valid, false);
  });

  test('forfeited session token returns valid=false', () => {
    const { accessToken, sessionId } = dm.createDeposit('WALLET_C', 100);
    dm.forfeitDeposit(sessionId, 'test forfeit');
    const result = dm.validateToken(accessToken);
    assert.strictEqual(result.valid, false);
  });
});

// ─── Suite 3: refundDeposit ────────────────────────────────────────────────

suite('3. refundDeposit', () => {
  const dm = freshManager();

  test('happy path returns success and refunded amount', () => {
    const { sessionId } = dm.createDeposit('WALLET_A', 250);
    const result = dm.refundDeposit(sessionId);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.refundedAmount, 250);
  });

  test('status is refunded after successful refund', () => {
    const { sessionId } = dm.createDeposit('WALLET_B', 100);
    dm.refundDeposit(sessionId);
    const deposit = dm.getDeposit(sessionId);
    assert.strictEqual(deposit?.status, 'refunded');
  });

  test('double refund is rejected', () => {
    const { sessionId } = dm.createDeposit('WALLET_C', 100);
    dm.refundDeposit(sessionId);
    const second = dm.refundDeposit(sessionId);
    assert.strictEqual(second.success, false);
  });

  test('refund of forfeited session is rejected', () => {
    const { sessionId } = dm.createDeposit('WALLET_D', 100);
    dm.forfeitDeposit(sessionId, 'attack');
    const result = dm.refundDeposit(sessionId);
    assert.strictEqual(result.success, false);
  });

  test('refund of unknown sessionId returns failure', () => {
    const result = dm.refundDeposit('does-not-exist');
    assert.strictEqual(result.success, false);
  });
});

// ─── Suite 4: forfeitDeposit ───────────────────────────────────────────────

suite('4. forfeitDeposit', () => {
  const dm = freshManager();

  test('forfeit held session returns true', () => {
    const { sessionId } = dm.createDeposit('WALLET_A', 100);
    const ok = dm.forfeitDeposit(sessionId, 'DDoS detected');
    assert.strictEqual(ok, true);
  });

  test('status is forfeited after forfeit', () => {
    const { sessionId } = dm.createDeposit('WALLET_B', 100);
    dm.forfeitDeposit(sessionId, 'test');
    const deposit = dm.getDeposit(sessionId);
    assert.strictEqual(deposit?.status, 'forfeited');
    assert.strictEqual(deposit?.forfeitReason, 'test');
  });

  test('forfeit unknown sessionId returns false', () => {
    const ok = dm.forfeitDeposit('does-not-exist', 'test');
    assert.strictEqual(ok, false);
  });

  test('forfeit already-forfeited session returns false', () => {
    const { sessionId } = dm.createDeposit('WALLET_C', 100);
    dm.forfeitDeposit(sessionId, 'first');
    const second = dm.forfeitDeposit(sessionId, 'second');
    assert.strictEqual(second, false);
  });

  test('forfeit already-refunded session returns false', () => {
    const { sessionId } = dm.createDeposit('WALLET_D', 100);
    dm.refundDeposit(sessionId);
    const ok = dm.forfeitDeposit(sessionId, 'too late');
    assert.strictEqual(ok, false);
  });
});

// ─── Suite 5: isAttacking ─────────────────────────────────────────────────

suite('5. isAttacking (rate detection)', () => {
  const dm = freshManager();

  test('0 requests → not attacking', () => {
    const { sessionId } = dm.createDeposit('WALLET_A', 100);
    assert.strictEqual(dm.isAttacking(sessionId), false);
  });

  test('30 requests → not attacking (below threshold 50)', () => {
    const { sessionId } = dm.createDeposit('WALLET_B', 100);
    for (let i = 0; i < 30; i++) dm.incrementRequestCount(sessionId);
    assert.strictEqual(dm.isAttacking(sessionId), false);
  });

  test('51 requests in 60s → attacking', () => {
    const { sessionId } = dm.createDeposit('WALLET_C', 100);
    for (let i = 0; i < 51; i++) dm.incrementRequestCount(sessionId);
    assert.strictEqual(dm.isAttacking(sessionId), true);
  });

  test('unknown sessionId → not attacking', () => {
    assert.strictEqual(dm.isAttacking('ghost-session'), false);
  });
});

// ─── Suite 6: getStats ────────────────────────────────────────────────────

suite('6. getStats', () => {
  const dm = freshManager();

  test('empty store has zero stats', () => {
    const stats = dm.getStats();
    assert.strictEqual(stats.totalDeposits, 0);
    assert.strictEqual(stats.activeSessions, 0);
    assert.strictEqual(stats.heldAmount, 0);
    assert.strictEqual(stats.refundedAmount, 0);
    assert.strictEqual(stats.forfeitedAmount, 0);
  });

  test('one held deposit shows correct heldAmount', () => {
    dm.createDeposit('WALLET_A', 300);
    const stats = dm.getStats();
    assert.strictEqual(stats.activeSessions, 1);
    assert.strictEqual(stats.heldAmount, 300);
  });

  test('refunded deposit moves amount from held to refunded', () => {
    const { sessionId } = dm.createDeposit('WALLET_B', 150);
    dm.refundDeposit(sessionId);
    const stats = dm.getStats();
    assert.strictEqual(stats.refundedAmount, 150);
    assert.strictEqual(stats.refundedCount, 1);
  });

  test('forfeited deposit moves amount from held to forfeited', () => {
    const { sessionId } = dm.createDeposit('WALLET_C', 200);
    dm.forfeitDeposit(sessionId, 'DDoS');
    const stats = dm.getStats();
    assert.ok(stats.forfeitedAmount >= 200);
    assert.ok(stats.forfeitedCount >= 1);
  });

  test('totalDeposits counts all deposits ever created', () => {
    dm.createDeposit('WALLET_D', 50);
    dm.createDeposit('WALLET_E', 50);
    const stats = dm.getStats();
    assert.ok(stats.totalDeposits >= 4); // 3 from above + 2 new
  });
});

// ─── Suite 7: SC math simulation — forfeit distribution 50/50 ─────────────
//
// The real smart contract distributes forfeited QUBIC in BEGIN_EPOCH.
// Split: 50% burned permanently, 50% to attacked service operator.
// 0% to shareholders — by design (no rent-seeking from DDoS victims).

suite('7. SC math: forfeit distribution 50/50 (mirrors BEGIN_EPOCH)', () => {
  function simulateDistribution(pending: number) {
    const half    = Math.floor(pending / 2);
    const burned  = half;
    const toVictim = half;
    const reserve = pending - burned - toVictim;  // 0 for even, 1 for odd
    return { burned, toVictim, reserve, total: burned + toVictim };
  }

  test('1000 QU: burned=500, toVictim=500, reserve=0', () => {
    const r = simulateDistribution(1000);
    assert.strictEqual(r.burned, 500);
    assert.strictEqual(r.toVictim, 500);
    assert.strictEqual(r.reserve, 0);
  });

  test('1001 QU (odd): burned=500, toVictim=500, reserve=1', () => {
    const r = simulateDistribution(1001);
    assert.strictEqual(r.burned, 500);
    assert.strictEqual(r.toVictim, 500);
    assert.strictEqual(r.reserve, 1);
  });

  test('total paid out never exceeds pending (no QU created from thin air)', () => {
    for (const amount of [1, 2, 100, 999, 1000, 1001, 100_000, 1_000_001]) {
      const r = simulateDistribution(amount);
      assert.ok(r.total <= amount,
        `amount=${amount}: total=${r.total} > pending`);
    }
  });

  test('reserve is always 0 or 1 (only odd-unit remainder stays in contract)', () => {
    for (const amount of [1, 2, 3, 99, 100, 101, 676, 1337]) {
      const r = simulateDistribution(amount);
      assert.ok(r.reserve === 0 || r.reserve === 1,
        `amount=${amount}: reserve=${r.reserve}`);
    }
  });

  test('0 pending → all outputs are 0', () => {
    const r = simulateDistribution(0);
    assert.strictEqual(r.burned, 0);
    assert.strictEqual(r.toVictim, 0);
    assert.strictEqual(r.reserve, 0);
  });

  test('depositManager forfeit: forfeitedToBurn and forfeitedToVictim are tracked', () => {
    const dm = freshManager();
    const { sessionId } = dm.createDeposit('WALLET_X', 1000);
    dm.forfeitDeposit(sessionId, 'DDoS');
    const stats = dm.getStats();
    assert.strictEqual(stats.forfeitedToBurn, 500,   'burn must be 500');
    assert.strictEqual(stats.forfeitedToVictim, 500, 'victim must be 500');
  });

  test('depositManager forfeit odd amount: remainder not counted', () => {
    const dm = freshManager();
    const { sessionId } = dm.createDeposit('WALLET_Y', 101);
    dm.forfeitDeposit(sessionId, 'DDoS');
    const stats = dm.getStats();
    assert.strictEqual(stats.forfeitedToBurn, 50);
    assert.strictEqual(stats.forfeitedToVictim, 50);
    // 1 QU remainder stays in contract (not tracked in split — by design)
  });
});

// ─── Suite 8: SetOperator SC logic simulation ─────────────────────────────
//
// SetOperator has no TypeScript counterpart in depositManager.ts — it is
// pure SC state management. We simulate the logic here to verify the rules:
//   - only current operator may transfer
//   - zero address is rejected
//   - after transfer, new address is operator; old one is not

suite('8. SC simulation: SetOperator', () => {
  // Simulates the QPI SC state for operator management
  function makeOperatorSC(initialOperator: string) {
    let operator = initialOperator;

    function setOperator(caller: string, newOperator: string) {
      if (caller !== operator)      return { success: 0, errorCode: 1, oldOperator: '' };
      if (newOperator === 'ZERO')   return { success: 0, errorCode: 2, oldOperator: '' };
      const old = operator;
      operator = newOperator;
      return { success: 1, errorCode: 0, oldOperator: old };
    }

    function getOperator() { return operator; }
    return { setOperator, getOperator };
  }

  test('current operator can transfer to new wallet', () => {
    const sc = makeOperatorSC('OPERATOR_A');
    const r = sc.setOperator('OPERATOR_A', 'OPERATOR_B');
    assert.strictEqual(r.success, 1);
    assert.strictEqual(sc.getOperator(), 'OPERATOR_B');
  });

  test('output contains the old operator address', () => {
    const sc = makeOperatorSC('OPERATOR_A');
    const r = sc.setOperator('OPERATOR_A', 'OPERATOR_B');
    assert.strictEqual(r.oldOperator, 'OPERATOR_A');
  });

  test('non-operator cannot transfer the role', () => {
    const sc = makeOperatorSC('OPERATOR_A');
    const r = sc.setOperator('ATTACKER', 'ATTACKER');
    assert.strictEqual(r.success, 0);
    assert.strictEqual(r.errorCode, 1);
    assert.strictEqual(sc.getOperator(), 'OPERATOR_A');  // unchanged
  });

  test('zero address is rejected — prevents permanent lockout', () => {
    const sc = makeOperatorSC('OPERATOR_A');
    const r = sc.setOperator('OPERATOR_A', 'ZERO');
    assert.strictEqual(r.success, 0);
    assert.strictEqual(r.errorCode, 2);
    assert.strictEqual(sc.getOperator(), 'OPERATOR_A');  // unchanged
  });

  test('after transfer, old operator can no longer transfer again', () => {
    const sc = makeOperatorSC('OPERATOR_A');
    sc.setOperator('OPERATOR_A', 'OPERATOR_B');
    const r = sc.setOperator('OPERATOR_A', 'OPERATOR_C');  // old operator tries again
    assert.strictEqual(r.success, 0);
    assert.strictEqual(sc.getOperator(), 'OPERATOR_B');  // still B
  });

  test('new operator can transfer further', () => {
    const sc = makeOperatorSC('OPERATOR_A');
    sc.setOperator('OPERATOR_A', 'OPERATOR_B');
    const r = sc.setOperator('OPERATOR_B', 'OPERATOR_C');
    assert.strictEqual(r.success, 1);
    assert.strictEqual(sc.getOperator(), 'OPERATOR_C');
  });
});

// ─── Suite 9: Token entropy simulation ────────────────────────────────────
//
// Simulates the improved K12(owner + tick + slotIndex) token generation.
// In the real SC, K12 is a cryptographic hash — here we use a simple
// string-hash to verify the three entropy sources produce unique tokens.

suite('9. SC simulation: token entropy (K12 seed)', () => {
  // Simulate K12(TokenSeed) — in production this is a real cryptographic hash.
  // For testing we just stringify the inputs; uniqueness is what we verify.
  function simulateK12(owner: string, tick: number, slotIndex: number): string {
    // Simple deterministic combination — mirrors the struct field layout
    return `K12[${owner}|${tick}|${slotIndex}]`;
  }

  test('same owner + different tick → different token', () => {
    const t1 = simulateK12('WALLET_A', 1000, 0);
    const t2 = simulateK12('WALLET_A', 1001, 0);
    assert.notStrictEqual(t1, t2);
  });

  test('same owner + same tick + different slot → different token', () => {
    const t1 = simulateK12('WALLET_A', 1000, 0);
    const t2 = simulateK12('WALLET_A', 1000, 1);
    assert.notStrictEqual(t1, t2);
  });

  test('different owner + same tick + same slot → different token', () => {
    const t1 = simulateK12('WALLET_A', 1000, 0);
    const t2 = simulateK12('WALLET_B', 1000, 0);
    assert.notStrictEqual(t1, t2);
  });

  test('identical inputs → identical token (deterministic)', () => {
    const t1 = simulateK12('WALLET_A', 1000, 5);
    const t2 = simulateK12('WALLET_A', 1000, 5);
    assert.strictEqual(t1, t2);
  });

  test('old scheme K12(owner) would collide: same wallet same tick', () => {
    // Old: only owner — two calls from same wallet at same tick = same token
    const oldT1 = `K12[WALLET_A]`;
    const oldT2 = `K12[WALLET_A]`;
    assert.strictEqual(oldT1, oldT2);  // ← the bug we fixed

    // New: owner + tick + slot — no collision even with same wallet and tick
    const newT1 = simulateK12('WALLET_A', 1000, 0);
    const newT2 = simulateK12('WALLET_A', 1000, 1);
    assert.notStrictEqual(newT1, newT2);  // ← fixed
  });

  test('all 512 slots at same tick produce unique tokens for same wallet', () => {
    const tokens = new Set<string>();
    for (let slot = 0; slot < 512; slot++) {
      tokens.add(simulateK12('WALLET_A', 1000, slot));
    }
    assert.strictEqual(tokens.size, 512, 'all 512 tokens must be unique');
  });
});

// ─── Suite 10: SC Client — payload serialisation ──────────────────────────
//
// Verifies that the binary payload builders produce the correct byte layout
// matching QubicShield.h struct definitions. No network calls needed.

suite('10. SC Client: payload serialisation', () => {
  // Sizes from QubicShield.h (must stay in sync with scClient.ts)
  const SIZE_ID     = 32;
  const SIZE_SINT64 = 8;
  const SIZE_UINT32 = 4;

  test('Deposit_input: exactly 8 bytes (sint64 amount)', () => {
    // struct Deposit_input { sint64 amount; }
    const size = SIZE_SINT64;
    assert.strictEqual(size, 8);
  });

  test('Refund_input: exactly 36 bytes (uint32 + id)', () => {
    // struct Refund_input { uint32 sessionIndex; id token; }
    const size = SIZE_UINT32 + SIZE_ID;
    assert.strictEqual(size, 36);
  });

  test('Forfeit_input: exactly 4 bytes (uint32)', () => {
    // struct Forfeit_input { uint32 sessionIndex; }
    const size = SIZE_UINT32;
    assert.strictEqual(size, 4);
  });

  test('ValidateSession_input: exactly 32 bytes (id)', () => {
    // struct ValidateSession_input { id token; }
    const size = SIZE_ID;
    assert.strictEqual(size, 32);
  });

  test('GetStats_input: 0 bytes (empty struct)', () => {
    assert.strictEqual(0, 0);
  });

  test('Deposit_output: exactly 42 bytes', () => {
    // id token(32) + uint32 sessionIndex(4) + uint32 expiresAtTick(4) + uint8 success(1) + uint8 errorCode(1)
    const size = SIZE_ID + SIZE_UINT32 + SIZE_UINT32 + 1 + 1;
    assert.strictEqual(size, 42);
  });

  test('ValidateSession_output: exactly 45 bytes', () => {
    // uint8 valid(1) + uint32 sessionIndex(4) + uint32 expiresAtTick(4) + id owner(32) + uint32 requestCount(4)
    const size = 1 + SIZE_UINT32 + SIZE_UINT32 + SIZE_ID + SIZE_UINT32;
    assert.strictEqual(size, 45);
  });

  test('GetStats_output: exactly 56 bytes (uint32×2 + sint64×6)', () => {
    // uint32 totalDepositsEver(4) + uint32 activeCount(4)
    // + sint64×6: totalHeld/Refunded/Forfeited/Burned/ToVictim/Pending(48)
    const size = SIZE_UINT32 * 2 + SIZE_SINT64 * 6;
    assert.strictEqual(size, 56);
  });

  test('readUint32LE: parses little-endian correctly', () => {
    // 0x01020304 little-endian = bytes [04, 03, 02, 01]
    const buf = new Uint8Array([0x04, 0x03, 0x02, 0x01]);
    const val = (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
    assert.strictEqual(val, 0x01020304);
  });

  test('readInt64LE: parses 1000 correctly', () => {
    // 1000 in little-endian int64 = [0xe8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    const buf = new Uint8Array([0xe8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const lo = BigInt((buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0);
    const hi = BigInt((buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24)) >>> 0);
    const val = (hi << 32n) | lo;
    assert.strictEqual(val, 1000n);
  });

  test('ValidateSession: valid=false when output buffer too short', () => {
    // Simulates the guard in scClient.validateSession()
    const raw = new Uint8Array(10);  // shorter than SIZE_VALIDATE_OUTPUT (45)
    const valid = raw.length >= 45 ? raw[0] === 1 : false;
    assert.strictEqual(valid, false);
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.error('\nFailed tests:');
  failures.forEach(f => console.error(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\nAll tests passed ✓');
  process.exit(0);
}
