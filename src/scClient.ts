/**
 * QubicShield SC Client
 *
 * Calls the deployed QubicShield smart contract via the Qubic RPC API.
 * Implements the same interface as DepositManager (the mock) so that
 * server.ts can switch between mock and real SC via USE_REAL_SC env var.
 *
 * Procedures (state-changing, require signed TX):
 *   Deposit(1), Refund(2), Forfeit(3),
 *   WithdrawForfeited(6), SetCreatorAddress(7), SetOperator(8)
 *
 * Functions (read-only, no signature needed):
 *   ValidateSession(4), GetStats(5)
 *
 * Binary layout mirrors the C++ structs in QubicShield.h exactly.
 * All multi-byte integers are little-endian (standard Qubic convention).
 *
 * BEFORE TESTNET DEPLOY: fill CONTRACT_ADDRESS and CONTRACT_INDEX below.
 */

import { QubicTransaction }    from '@qubic-lib/qubic-ts-library/dist/qubic-types/QubicTransaction';
import { PublicKey }            from '@qubic-lib/qubic-ts-library/dist/qubic-types/PublicKey';
import { Long }                 from '@qubic-lib/qubic-ts-library/dist/qubic-types/Long';
import { DynamicPayload }       from '@qubic-lib/qubic-ts-library/dist/qubic-types/DynamicPayload';
import { QubicPackageBuilder }  from '@qubic-lib/qubic-ts-library/dist/QubicPackageBuilder';

// ---------------------------------------------------------------------------
// Configuration — fill these after testnet deploy
// ---------------------------------------------------------------------------

const RPC_BASE = process.env.QUBIC_RPC ?? 'https://testnet-rpc.qubic.org';

/** 60-char public ID assigned to the contract after deployment */
const CONTRACT_ADDRESS = process.env.SC_ADDRESS ?? 'PLACEHOLDER_REPLACE_AFTER_DEPLOY';

/** Numeric index assigned to the contract at deployment (different from address) */
const CONTRACT_INDEX = parseInt(process.env.SC_INDEX ?? '0', 10);

/** How many ticks in the future the TX should be valid for (~15 recommended) */
const TX_TICK_OFFSET = 15;

/**
 * Resilience constants — two failure modes are handled automatically:
 *
 * 1. Network unavailable (Qubic epoch transition, every Wednesday ~12 UTC, up to 45 min):
 *    broadcastProcedure retries up to TX_MAX_RETRIES times with TX_RETRY_DELAY_MS between
 *    each attempt. 5 × 8 s = 40 s of retry window — enough for brief outages.
 *    For epoch-transition-length outages the caller should surface the error to the user.
 *
 * 2. Stale tick (TX broadcast OK but target tick already processed → TX silently dropped):
 *    When confirmAfterBroadcast=true, we wait TX_CONFIRM_WAIT_MS after the broadcast and
 *    poll the RPC. If the TX is not confirmed we retry with a freshly fetched tick.
 *    This flag should be true for background/critical operations (forfeit).
 */
const TX_MAX_RETRIES     = 5;
const TX_RETRY_DELAY_MS  = 8_000;   // 8 s between retries
const TX_CONFIRM_WAIT_MS = 12_000;  // wait after broadcast before checking confirmation (~24 ticks)

// ---------------------------------------------------------------------------
// Entry point indices (must match REGISTER_USER_* in QubicShield.h)
// ---------------------------------------------------------------------------
const IDX_DEPOSIT          = 1;
const IDX_REFUND           = 2;
const IDX_FORFEIT          = 3;
const IDX_VALIDATE_SESSION = 4;
const IDX_GET_STATS        = 5;

// ---------------------------------------------------------------------------
// C++ struct sizes (bytes) — mirrors QubicShield.h exactly
//
// id      = 32 bytes
// sint64  = 8 bytes
// uint32  = 4 bytes
// uint8   = 1 byte
// ---------------------------------------------------------------------------
const SIZE_ID      = 32;
const SIZE_SINT64  = 8;
const SIZE_UINT32  = 4;
const SIZE_UINT8   = 1;

// Input struct sizes
const SIZE_DEPOSIT_INPUT           = SIZE_SINT64;                                         //  8
const SIZE_REFUND_INPUT            = SIZE_UINT32 + SIZE_ID;                               // 36
const SIZE_FORFEIT_INPUT           = SIZE_UINT32;                                          //  4
const SIZE_VALIDATE_SESSION_INPUT  = SIZE_ID;                                             // 32
const SIZE_GET_STATS_INPUT         = 0;                                                   //  0

// Output struct sizes
const SIZE_DEPOSIT_OUTPUT          = SIZE_ID + SIZE_UINT32 + SIZE_UINT32 + SIZE_UINT8 * 2; // 42
const SIZE_VALIDATE_OUTPUT         = SIZE_UINT8 + SIZE_UINT32 + SIZE_UINT32 + SIZE_ID + SIZE_UINT32; // 45
// GetStats_output: uint32×2 + sint64×6 = 8 + 48 = 56
const SIZE_GET_STATS_OUTPUT        = SIZE_UINT32 * 2 + SIZE_SINT64 * 6;                    // 56

// ---------------------------------------------------------------------------
// Result types (same shape as depositManager.ts for easy swapping)
// ---------------------------------------------------------------------------

export interface ScDepositResult {
  success: boolean;
  errorCode: number;
  token: Uint8Array;        // 32-byte session token
  sessionIndex: number;
  expiresAtTick: number;
  txId?: string;            // Qubic transaction ID for reference
}

export interface ScValidateResult {
  valid: boolean;
  sessionIndex: number;
  expiresAtTick: number;
  requestCount: number;
}

export interface ScRefundResult {
  success: boolean;
  errorCode: number;
  refundedAmount: bigint;
  txId?: string;
}

export interface ScForfeitResult {
  success: boolean;
  errorCode: number;
  txId?: string;
}

export interface ScStatsResult {
  totalDepositsEver: number;
  activeCount: number;
  totalHeld: bigint;
  totalRefunded: bigint;
  totalForfeited: bigint;
  totalBurned: bigint;
  totalToVictim: bigint;
  pendingDistribution: bigint;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the current network tick from the RPC.
 * Retries up to TX_MAX_RETRIES times on network errors (e.g. epoch transition).
 */
async function getCurrentTick(): Promise<number> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= TX_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${RPC_BASE}/v1/tick-info`);
      if (!res.ok) throw new Error(`tick-info HTTP ${res.status}`);
      const data = await res.json() as { tickInfo?: { tick?: number }; tick?: number };
      const tick = data?.tickInfo?.tick ?? data?.tick;
      if (!tick) throw new Error('tick not found in response');
      return tick;
    } catch (err) {
      lastError = err as Error;
      if (attempt < TX_MAX_RETRIES) {
        console.warn(
          `[scClient] getCurrentTick attempt ${attempt}/${TX_MAX_RETRIES} failed: ${lastError.message}` +
          ` — retrying in ${TX_RETRY_DELAY_MS / 1000}s (epoch transition?)`
        );
        await new Promise(resolve => setTimeout(resolve, TX_RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(`getCurrentTick failed after ${TX_MAX_RETRIES} attempts: ${lastError?.message}`);
}

/** Read a uint32 from a Uint8Array at the given byte offset (little-endian) */
function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    buf[offset] |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    (buf[offset + 3] << 24)
  ) >>> 0;
}

/** Read a sint64 from a Uint8Array at the given byte offset (little-endian) */
function readInt64LE(buf: Uint8Array, offset: number): bigint {
  const lo = BigInt(readUint32LE(buf, offset));
  const hi = BigInt(readUint32LE(buf, offset + 4));
  const raw = (hi << 32n) | lo;
  // Convert to signed
  return raw >= 0x8000000000000000n ? raw - 0x10000000000000000n : raw;
}

/** Base64-encode a Uint8Array */
function toBase64(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64');
}

/** Base64-decode to Uint8Array */
function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Build, sign and broadcast a transaction to the SC.
 * Returns the transaction ID.
 *
 * Handles two failure modes automatically:
 *
 * 1. Network unavailable (epoch transition every Wednesday ~12 UTC, up to 45 min):
 *    getCurrentTick() already retries. If even that fails we let the error propagate
 *    so the caller can surface it to the user with an appropriate message.
 *
 * 2. Stale tick (TX broadcast OK but target tick already past → TX silently dropped):
 *    After broadcasting we wait TX_CONFIRM_WAIT_MS and check whether the tick has
 *    advanced past our target. If so, the TX was likely dropped and we retry with a
 *    freshly fetched tick. We repeat up to TX_MAX_RETRIES times total.
 */
async function broadcastProcedure(
  senderSeed: string,
  senderPublicId: string,
  inputType: number,
  payload: Uint8Array,
  amount: bigint = 0n,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= TX_MAX_RETRIES; attempt++) {
    // Always fetch a fresh tick — stale ticks are the #1 silent failure mode
    const currentTick = await getCurrentTick();
    const targetTick  = currentTick + TX_TICK_OFFSET;

    const dynPayload = new DynamicPayload(payload.length);
    dynPayload.setPayload(payload);

    const tx = new QubicTransaction()
      .setSourcePublicKey(new PublicKey(senderPublicId))
      .setDestinationPublicKey(new PublicKey(CONTRACT_ADDRESS))
      .setAmount(new Long(Number(amount)))
      .setTick(targetTick)
      .setInputType(inputType)
      .setPayload(dynPayload);

    const builtData = await tx.build(senderSeed);
    const encoded   = tx.encodeTransactionToBase64(builtData);

    try {
      const res = await fetch(`${RPC_BASE}/v1/broadcast-transaction`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ encodedTransaction: encoded }),
      });

      if (!res.ok) throw new Error(`broadcast-transaction HTTP ${res.status}`);

      const txId = tx.id ?? '';

      // Wait, then verify the tick has not already been skipped over.
      // If the network tick is already past targetTick the TX was silently dropped.
      await new Promise(resolve => setTimeout(resolve, TX_CONFIRM_WAIT_MS));
      const tickAfterWait = await getCurrentTick();

      if (tickAfterWait > targetTick) {
        // TX dropped — stale tick. Retry with a new tick on next loop iteration.
        lastError = new Error(
          `TX likely dropped: targetTick=${targetTick} but network is already at ${tickAfterWait}`
        );
        console.warn(
          `[scClient] broadcastProcedure attempt ${attempt}/${TX_MAX_RETRIES}: ${lastError.message}` +
          ` — retrying with fresh tick`
        );
        continue;
      }

      // Tick not yet past targetTick → TX is (or will be) in the pool
      return txId;

    } catch (err) {
      lastError = err as Error;
      if (attempt < TX_MAX_RETRIES) {
        console.warn(
          `[scClient] broadcastProcedure attempt ${attempt}/${TX_MAX_RETRIES} failed: ${lastError.message}` +
          ` — retrying in ${TX_RETRY_DELAY_MS / 1000}s`
        );
        await new Promise(resolve => setTimeout(resolve, TX_RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(`broadcastProcedure failed after ${TX_MAX_RETRIES} attempts: ${lastError?.message}`);
}

/**
 * Call a PUBLIC_FUNCTION (read-only, no signature needed).
 * Returns the raw response bytes.
 * Retries on network errors (epoch transition).
 */
async function queryFunction(
  inputType: number,
  payload: Uint8Array,
): Promise<Uint8Array> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= TX_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${RPC_BASE}/v1/querySmartContract`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractIndex: CONTRACT_INDEX,
          inputType,
          inputSize:   payload.length,
          requestData: toBase64(payload),
        }),
      });

      if (!res.ok) throw new Error(`querySmartContract HTTP ${res.status}`);
      const data = await res.json() as { responseData?: string };
      return fromBase64(data.responseData ?? '');

    } catch (err) {
      lastError = err as Error;
      if (attempt < TX_MAX_RETRIES) {
        console.warn(
          `[scClient] queryFunction attempt ${attempt}/${TX_MAX_RETRIES} failed: ${lastError.message}` +
          ` — retrying in ${TX_RETRY_DELAY_MS / 1000}s (epoch transition?)`
        );
        await new Promise(resolve => setTimeout(resolve, TX_RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(`queryFunction failed after ${TX_MAX_RETRIES} attempts: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deposit QUBIC to start a protected session.
 * Mirrors depositManager.createDeposit().
 *
 * @param senderSeed    55-char Qubic seed of the user's wallet
 * @param senderPublicId  60-char public ID of the user's wallet
 * @param amount        QUBIC units to deposit (min 10 per QubicShield.h)
 */
export async function deposit(
  senderSeed: string,
  senderPublicId: string,
  amount: bigint,
): Promise<ScDepositResult> {
  // Deposit_input: { sint64 amount }
  const builder = new QubicPackageBuilder(SIZE_DEPOSIT_INPUT);
  builder.add(new Long(Number(amount)));
  const payload = builder.getData();

  const txId = await broadcastProcedure(senderSeed, senderPublicId, IDX_DEPOSIT, payload, amount);

  // NOTE: The actual token and sessionIndex are in the TX output.
  // Qubic does not return procedure output synchronously in broadcast-transaction.
  // They are readable after the TX is confirmed via GET /v1/querySmartContract
  // or by listening to tick data. For the PoC we return the txId and instruct
  // the caller to poll ValidateSession after tick confirmation.
  return {
    success:      true,
    errorCode:    0,
    token:        new Uint8Array(SIZE_ID),  // filled after TX confirmation
    sessionIndex: 0,                        // filled after TX confirmation
    expiresAtTick: 0,                       // filled after TX confirmation
    txId,
  };
}

/**
 * Validate whether a session token is still active.
 * Mirrors depositManager.validateToken().
 * This is a PUBLIC_FUNCTION — no signature needed, instant response.
 *
 * @param token  32-byte session token (Uint8Array)
 */
export async function validateSession(token: Uint8Array): Promise<ScValidateResult> {
  // ValidateSession_input: { id token } = 32 bytes
  const payload = token.slice(0, SIZE_ID);
  const raw = await queryFunction(IDX_VALIDATE_SESSION, payload);

  // ValidateSession_output layout:
  //   uint8  valid          [0]
  //   uint32 sessionIndex   [1..4]
  //   uint32 expiresAtTick  [5..8]
  //   id     owner          [9..40]
  //   uint32 requestCount   [41..44]
  if (raw.length < SIZE_VALIDATE_OUTPUT) {
    return { valid: false, sessionIndex: 0, expiresAtTick: 0, requestCount: 0 };
  }

  return {
    valid:         raw[0] === 1,
    sessionIndex:  readUint32LE(raw, 1),
    expiresAtTick: readUint32LE(raw, 5),
    requestCount:  readUint32LE(raw, 41),
  };
}

/**
 * Refund a deposit — user ends session cleanly, QUBIC returned.
 * Mirrors depositManager.refundDeposit().
 *
 * @param senderSeed      user's seed
 * @param senderPublicId  user's public ID
 * @param sessionIndex    the index returned by Deposit
 * @param token           the 32-byte token returned by Deposit
 */
export async function refund(
  senderSeed: string,
  senderPublicId: string,
  sessionIndex: number,
  token: Uint8Array,
): Promise<ScRefundResult> {
  // Refund_input: { uint32 sessionIndex, id token }
  const builder = new QubicPackageBuilder(SIZE_REFUND_INPUT);
  builder.addInt(sessionIndex);
  builder.addRaw(token.slice(0, SIZE_ID));
  const payload = builder.getData();

  const txId = await broadcastProcedure(senderSeed, senderPublicId, IDX_REFUND, payload);
  return { success: true, errorCode: 0, refundedAmount: 0n, txId };
}

/**
 * Forfeit a session — operator marks session as attacker.
 * Mirrors depositManager.forfeitDeposit().
 *
 * @param operatorSeed      operator's seed
 * @param operatorPublicId  operator's public ID
 * @param sessionIndex      which session to forfeit
 */
export async function forfeit(
  operatorSeed: string,
  operatorPublicId: string,
  sessionIndex: number,
): Promise<ScForfeitResult> {
  // Forfeit_input: { uint32 sessionIndex }
  const builder = new QubicPackageBuilder(SIZE_FORFEIT_INPUT);
  builder.addInt(sessionIndex);
  const payload = builder.getData();

  const txId = await broadcastProcedure(operatorSeed, operatorPublicId, IDX_FORFEIT, payload);
  return { success: true, errorCode: 0, txId };
}

/**
 * Read aggregate statistics from the SC.
 * Mirrors depositManager.getStats().
 * This is a PUBLIC_FUNCTION — no signature needed.
 */
export async function getStats(): Promise<ScStatsResult> {
  const raw = await queryFunction(IDX_GET_STATS, new Uint8Array(0));

  // GetStats_output layout:
  //   uint32 totalDepositsEver   [0..3]
  //   uint32 activeCount         [4..7]
  //   sint64 totalHeld           [8..15]
  //   sint64 totalRefunded       [16..23]
  //   sint64 totalForfeited      [24..31]
  //   sint64 totalBurned         [32..39]
  //   sint64 totalToVictim       [40..47]
  //   sint64 pendingDistribution [48..55]
  if (raw.length < SIZE_GET_STATS_OUTPUT) {
    return {
      totalDepositsEver: 0, activeCount: 0,
      totalHeld: 0n, totalRefunded: 0n, totalForfeited: 0n,
      totalBurned: 0n, totalToVictim: 0n, pendingDistribution: 0n,
    };
  }

  return {
    totalDepositsEver:   readUint32LE(raw, 0),
    activeCount:         readUint32LE(raw, 4),
    totalHeld:           readInt64LE(raw, 8),
    totalRefunded:       readInt64LE(raw, 16),
    totalForfeited:      readInt64LE(raw, 24),
    totalBurned:         readInt64LE(raw, 32),
    totalToVictim:       readInt64LE(raw, 40),
    pendingDistribution: readInt64LE(raw, 48),
  };
}
