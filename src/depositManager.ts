import { v4 as uuidv4 } from 'uuid';

export interface Deposit {
  sessionId: string;
  walletAddress: string;
  amount: number; // in QUBIC units
  createdAt: number;
  expiresAt: number;
  status: 'held' | 'refunded' | 'forfeited';
  requestCount: number;
  forfeitReason?: string;
}

interface TokenMapping {
  sessionId: string;
  createdAt: number;
}

export interface ShieldEvent {
  id:        number;
  ts:        number;         // Date.now()
  type:      'deposit' | 'refund' | 'forfeit' | 'access' | 'attack';
  sessionId: string;
  wallet:    string;
  amount:    number;
  detail?:   string;
}

/**
 * Mock implementation of the Qubic Smart Contract for deposit management.
 * All state is kept in-memory (Map). In production this would interact
 * with the actual Qubic SC via RPC.
 */
class DepositManager {
  private deposits: Map<string, Deposit> = new Map();
  private tokenToSession: Map<string, TokenMapping> = new Map();

  /** Session TTL: 30 minutes */
  private readonly SESSION_TTL_MS = 30 * 60 * 1000;

  /** Attack threshold: more than 50 requests per minute (matches rateLimiter) */
  private readonly ATTACK_THRESHOLD = 50;

  /** Request timestamps per session for rate tracking (sliding window) */
  private requestTimestamps: Map<string, number[]> = new Map();

  // 50/50 split accumulators — mirrors the SC's BEGIN_EPOCH distribution
  private forfeitedToBurn   = 0;   // 50% → permanently removed from supply
  private forfeitedToVictim = 0;   // 50% → transferred to the attacked service operator

  // Event log — last MAX_EVENTS entries, newest first
  private readonly MAX_EVENTS = 50;
  private eventLog: ShieldEvent[] = [];
  private nextEventId = 1;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create a new deposit and return a session ID + access token.
   */
  createDeposit(
    walletAddress: string,
    amount: number
  ): { sessionId: string; accessToken: string } {
    const sessionId = uuidv4();
    const accessToken = uuidv4();
    const now = Date.now();

    const deposit: Deposit = {
      sessionId,
      walletAddress,
      amount,
      createdAt: now,
      expiresAt: now + this.SESSION_TTL_MS,
      status: 'held',
      requestCount: 0,
    };

    this.deposits.set(sessionId, deposit);
    this.tokenToSession.set(accessToken, { sessionId, createdAt: now });
    this.requestTimestamps.set(sessionId, []);

    this._logEvent({ type: 'deposit', sessionId, wallet: walletAddress, amount });

    console.log(
      `[DepositManager] Deposit created: sessionId=${sessionId} wallet=${walletAddress} amount=${amount} QUBIC`
    );

    return { sessionId, accessToken };
  }

  /**
   * Validate whether an access token is still valid (exists and not expired/forfeited/refunded).
   */
  validateToken(accessToken: string): { valid: boolean; sessionId?: string; expiresAt?: number } {
    const mapping = this.tokenToSession.get(accessToken);
    if (!mapping) {
      return { valid: false };
    }

    const deposit = this.deposits.get(mapping.sessionId);
    if (!deposit) {
      return { valid: false };
    }

    if (deposit.status !== 'held') {
      return { valid: false };
    }

    if (Date.now() > deposit.expiresAt) {
      // Auto-forfeit expired sessions
      this._forfeitDeposit(deposit, 'Session expired');
      return { valid: false };
    }

    return { valid: true, sessionId: deposit.sessionId, expiresAt: deposit.expiresAt };
  }

  /**
   * Refund a deposit when the user cleanly ends their session.
   * Returns false if the session cannot be refunded (already processed, attacking etc.).
   */
  refundDeposit(sessionId: string): { success: boolean; refundedAmount?: number; message: string } {
    const deposit = this.deposits.get(sessionId);
    if (!deposit) {
      return { success: false, message: 'Session not found.' };
    }

    if (deposit.status === 'refunded') {
      return { success: false, message: 'Deposit already refunded.' };
    }

    if (deposit.status === 'forfeited') {
      return {
        success: false,
        message: `Deposit was forfeited: ${deposit.forfeitReason ?? 'unknown reason'}.`,
      };
    }

    if (this.isAttacking(sessionId)) {
      this._forfeitDeposit(deposit, 'Attack pattern detected during refund attempt');
      return { success: false, message: 'Deposit forfeited: attack pattern detected.' };
    }

    deposit.status = 'refunded';
    this.deposits.set(sessionId, deposit);

    this._logEvent({ type: 'refund', sessionId, wallet: deposit.walletAddress, amount: deposit.amount });

    console.log(
      `[DepositManager] Deposit refunded: sessionId=${sessionId} amount=${deposit.amount} QUBIC`
    );

    return {
      success: true,
      refundedAmount: deposit.amount,
      message: `${deposit.amount} QUBIC refunded to ${deposit.walletAddress}.`,
    };
  }

  /**
   * Forfeit a deposit (called when attack is detected).
   */
  forfeitDeposit(sessionId: string, reason: string): boolean {
    const deposit = this.deposits.get(sessionId);
    if (!deposit || deposit.status !== 'held') {
      return false;
    }
    this._forfeitDeposit(deposit, reason);
    return true;
  }

  /**
   * Return recent events for the dashboard (newest first).
   */
  getEvents(limit = 50): ShieldEvent[] {
    return this.eventLog.slice(0, limit);
  }

  /**
   * Increment the request counter for a session and record the timestamp
   * for the sliding-window rate limiter.
   */
  incrementRequestCount(sessionId: string): void {
    const deposit = this.deposits.get(sessionId);
    if (!deposit) return;

    deposit.requestCount += 1;
    this.deposits.set(sessionId, deposit);

    this._logEvent({
      type: 'access', sessionId,
      wallet: deposit.walletAddress, amount: deposit.amount,
      detail: `req #${deposit.requestCount}`,
    });

    // Record timestamp for sliding-window rate detection
    const timestamps = this.requestTimestamps.get(sessionId) ?? [];
    timestamps.push(Date.now());
    this.requestTimestamps.set(sessionId, timestamps);
  }

  /**
   * Returns true if the session has exceeded the attack threshold
   * (more than 100 requests within the last 60 seconds).
   */
  isAttacking(sessionId: string): boolean {
    const timestamps = this.requestTimestamps.get(sessionId);
    if (!timestamps) return false;

    const oneMinuteAgo = Date.now() - 60_000;
    const recentRequests = timestamps.filter((ts) => ts > oneMinuteAgo);

    // Prune old entries to keep memory bounded
    this.requestTimestamps.set(sessionId, recentRequests);

    return recentRequests.length > this.ATTACK_THRESHOLD;
  }

  /**
   * Return a deposit object by session ID (read-only copy).
   */
  getDeposit(sessionId: string): Deposit | undefined {
    const d = this.deposits.get(sessionId);
    return d ? { ...d } : undefined;
  }

  /**
   * Return a deposit by access token (read-only copy).
   */
  getDepositByToken(accessToken: string): Deposit | undefined {
    const mapping = this.tokenToSession.get(accessToken);
    if (!mapping) return undefined;
    return this.getDeposit(mapping.sessionId);
  }

  /**
   * Aggregate statistics across all deposits.
   * forfeitedToBurn and forfeitedToVictim reflect the 50/50 split:
   *   50% → burned (removed from QUBIC supply)
   *   50% → victim (transferred to the attacked service operator)
   */
  getStats(): {
    totalDeposits: number;
    activeSessions: number;
    heldAmount: number;
    refundedAmount: number;
    forfeitedAmount: number;
    forfeitedToBurn: number;
    forfeitedToVictim: number;
    refundedCount: number;
    forfeitedCount: number;
  } {
    let heldAmount = 0;
    let refundedAmount = 0;
    let forfeitedAmount = 0;
    let activeSessions = 0;
    let refundedCount = 0;
    let forfeitedCount = 0;

    for (const deposit of this.deposits.values()) {
      if (deposit.status === 'held') {
        heldAmount += deposit.amount;
        activeSessions += 1;
      } else if (deposit.status === 'refunded') {
        refundedAmount += deposit.amount;
        refundedCount += 1;
      } else if (deposit.status === 'forfeited') {
        forfeitedAmount += deposit.amount;
        forfeitedCount += 1;
      }
    }

    return {
      totalDeposits: this.deposits.size,
      activeSessions,
      heldAmount,
      refundedAmount,
      forfeitedAmount,
      forfeitedToBurn: this.forfeitedToBurn,
      forfeitedToVictim: this.forfeitedToVictim,
      refundedCount,
      forfeitedCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _forfeitDeposit(deposit: Deposit, reason: string): void {
    deposit.status = 'forfeited';
    deposit.forfeitReason = reason;
    this.deposits.set(deposit.sessionId, deposit);

    const half = Math.floor(deposit.amount / 2);
    this.forfeitedToBurn   += half;
    this.forfeitedToVictim += half;

    this._logEvent({
      type: 'attack', sessionId: deposit.sessionId,
      wallet: deposit.walletAddress, amount: deposit.amount,
      detail: reason,
    });

    console.warn(
      `[DepositManager] Deposit FORFEITED: sessionId=${deposit.sessionId} reason="${reason}" ` +
      `amount=${deposit.amount} QUBIC → ${half} burned + ${half} to victim`
    );
  }

  private _logEvent(ev: Omit<ShieldEvent, 'id' | 'ts'>): void {
    this.eventLog.unshift({ id: this.nextEventId++, ts: Date.now(), ...ev });
    if (this.eventLog.length > this.MAX_EVENTS) {
      this.eventLog.length = this.MAX_EVENTS;
    }
  }
}

// Export a singleton instance – mirrors a deployed SC
export default new DepositManager();
