import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import depositManager from './depositManager';
import * as scClient from './scClient';
import { rateLimiter } from './middleware/rateLimiter';

const USE_REAL_SC = process.env.USE_REAL_SC === 'true';

const app = express();
const PORT = 3000;

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// Auth middleware (used by /api/protected)
// ---------------------------------------------------------------------------

interface AuthenticatedRequest extends Request {
  sessionId?: string;
  accessToken?: string;
}

async function requireValidToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    return;
  }

  const token = auth.slice(7);

  if (USE_REAL_SC) {
    const tokenBytes = Buffer.from(token, 'hex');
    if (tokenBytes.length !== 32) {
      res.status(401).json({ error: 'Token must be 64 hex chars (32 bytes) in SC mode.' });
      return;
    }
    try {
      const result = await scClient.validateSession(new Uint8Array(tokenBytes));
      if (!result.valid) {
        res.status(401).json({ error: 'Token invalid or expired. Please create a new deposit.' });
        return;
      }
      req.sessionId  = String(result.sessionIndex);
      req.accessToken = token;
      next();
    } catch (err) {
      res.status(502).json({ error: `SC validateSession failed: ${(err as Error).message}` });
    }
    return;
  }

  const result = depositManager.validateToken(token);
  if (!result.valid) {
    res.status(401).json({ error: 'Token invalid or expired. Please create a new deposit.' });
    return;
  }

  req.sessionId = result.sessionId;
  req.accessToken = token;
  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/deposit
 *
 * Mock mode:  { walletAddress: string, amount: number }
 * SC mode:    { senderSeed: string, senderPublicId: string, amount: number }
 */
app.post('/api/deposit', async (req: Request, res: Response) => {
  const body = req.body as {
    walletAddress?: string;
    senderSeed?: string;
    senderPublicId?: string;
    amount?: number;
  };
  const { amount } = body;

  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number.' });
    return;
  }

  if (USE_REAL_SC) {
    const { senderSeed, senderPublicId } = body;
    if (!senderSeed || !senderPublicId) {
      res.status(400).json({ error: 'senderSeed and senderPublicId are required in SC mode.' });
      return;
    }
    try {
      const result = await scClient.deposit(senderSeed, senderPublicId, BigInt(amount));
      res.status(201).json({
        txId:         result.txId,
        depositAmount: amount,
        message:      `TX broadcast. Poll /api/validate/<tokenHex> after tick confirmation.`,
      });
    } catch (err) {
      res.status(502).json({ error: `SC deposit failed: ${(err as Error).message}` });
    }
    return;
  }

  const { walletAddress } = body;
  if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') {
    res.status(400).json({ error: 'walletAddress is required.' });
    return;
  }

  const { sessionId, accessToken } = depositManager.createDeposit(walletAddress.trim(), amount);
  const deposit = depositManager.getDeposit(sessionId);
  res.status(201).json({
    sessionId,
    accessToken,
    expiresAt:    deposit?.expiresAt,
    depositAmount: amount,
    message:      `Deposit of ${amount} QUBIC held. Use the accessToken as Bearer token.`,
  });
});

// ---------------------------------------------------------------------------

/**
 * GET /api/validate/:token
 *
 * Mock mode:  token is the UUID accessToken string
 * SC mode:    token is the hex-encoded 32-byte session token
 */
app.get('/api/validate/:token', async (req: Request, res: Response) => {
  const { token } = req.params;

  if (USE_REAL_SC) {
    try {
      const tokenBytes = Buffer.from(token, 'hex');
      if (tokenBytes.length !== 32) {
        res.status(400).json({ error: 'token must be 64 hex chars (32 bytes).' });
        return;
      }
      const result = await scClient.validateSession(new Uint8Array(tokenBytes));
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: `SC validateSession failed: ${(err as Error).message}` });
    }
    return;
  }

  const result = depositManager.validateToken(token);
  if (result.valid) {
    const deposit = depositManager.getDeposit(result.sessionId!);
    res.json({
      valid:        true,
      sessionId:    result.sessionId,
      expiresAt:    result.expiresAt,
      requestCount: deposit?.requestCount ?? 0,
      walletAddress: deposit?.walletAddress,
      depositAmount: deposit?.amount,
    });
  } else {
    res.json({ valid: false });
  }
});

// ---------------------------------------------------------------------------

/**
 * POST /api/refund
 *
 * Mock mode:  { sessionId: string }
 * SC mode:    { senderSeed: string, senderPublicId: string, sessionIndex: number, token: string (hex) }
 */
app.post('/api/refund', async (req: Request, res: Response) => {
  const body = req.body as {
    sessionId?: string;
    senderSeed?: string;
    senderPublicId?: string;
    sessionIndex?: number;
    token?: string;
  };

  if (USE_REAL_SC) {
    const { senderSeed, senderPublicId, sessionIndex, token } = body;
    if (!senderSeed || !senderPublicId || sessionIndex === undefined || !token) {
      res.status(400).json({ error: 'senderSeed, senderPublicId, sessionIndex and token (hex) are required in SC mode.' });
      return;
    }
    const tokenBytes = Buffer.from(token, 'hex');
    if (tokenBytes.length !== 32) {
      res.status(400).json({ error: 'token must be 64 hex chars (32 bytes).' });
      return;
    }
    try {
      const result = await scClient.refund(senderSeed, senderPublicId, sessionIndex, new Uint8Array(tokenBytes));
      res.json({ success: result.success, txId: result.txId });
    } catch (err) {
      res.status(502).json({ error: `SC refund failed: ${(err as Error).message}` });
    }
    return;
  }

  const { sessionId } = body;
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required.' });
    return;
  }

  const result = depositManager.refundDeposit(sessionId);
  if (result.success) {
    res.json({ success: true, refundedAmount: result.refundedAmount, message: result.message });
  } else {
    res.status(400).json({ success: false, message: result.message });
  }
});

// ---------------------------------------------------------------------------

/**
 * GET /api/protected
 * Header: Authorization: Bearer <token>
 *
 * Counts the request. If the session is attacking, forfeit deposit and return 403.
 */
app.get(
  '/api/protected',
  rateLimiter,
  requireValidToken,
  (req: AuthenticatedRequest, res: Response) => {
    const sessionId = req.sessionId!;

    // Increment before attack check so the count is accurate
    depositManager.incrementRequestCount(sessionId);

    const isAttacking =
      (res.locals['isAttacking'] as boolean) || depositManager.isAttacking(sessionId);

    if (isAttacking) {
      const depositBefore = depositManager.getDeposit(sessionId);
      const forfeitedAmount = depositBefore?.amount ?? 0;
      depositManager.forfeitDeposit(sessionId, 'DDoS attack pattern detected (>50 req/min)');

      const half = Math.floor(forfeitedAmount / 2);
      res.status(403).json({
        error:          'Attack pattern detected. Deposit has been forfeited.',
        sessionId,
        forfeitedAmount,
        distribution: {
          burned:       half,
          toVictim:     half,
          note:         '50% burned permanently · 50% transferred to the attacked service operator',
        },
      });
      return;
    }

    const deposit = depositManager.getDeposit(sessionId);
    const remainingMs = (deposit?.expiresAt ?? 0) - Date.now();
    const remainingTime = Math.max(0, Math.round(remainingMs / 1000));

    res.json({
      message: 'Zugang gewährt — Protected resource accessed.',
      sessionId,
      requestCount: deposit?.requestCount ?? 0,
      remainingTime,
      walletAddress: deposit?.walletAddress,
    });
  }
);

// ---------------------------------------------------------------------------

/**
 * GET /api/probe?url=...
 *
 * Server-side URL probe. Returns the HTTP status of the given URL so the
 * demo page can make routing decisions without running into CORS restrictions.
 */
app.get('/api/probe', async (req: Request, res: Response) => {
  const url = req.query['url'] as string | undefined;
  if (!url || !url.startsWith('http')) {
    res.status(400).json({ error: 'url query parameter is required and must start with http.' });
    return;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    res.json({ url, status: response.status, ok: response.ok });
  } catch (err) {
    res.json({ url, status: 0, ok: false, error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------

/**
 * GET /api/events?limit=N
 * Returns the most recent N deposit/refund/forfeit/access/attack events (mock mode only).
 */
app.get('/api/events', (_req: Request, res: Response) => {
  if (USE_REAL_SC) {
    res.status(501).json({ error: 'Event log not available in SC mode.' });
    return;
  }
  const limit = Math.min(parseInt(String(_req.query['limit'] ?? '50')), 100);
  res.json(depositManager.getEvents(limit));
});

// ---------------------------------------------------------------------------

/**
 * GET /api/stats
 */
app.get('/api/stats', async (_req: Request, res: Response) => {
  if (USE_REAL_SC) {
    try {
      const stats = await scClient.getStats();
      res.json(stats);
    } catch (err) {
      res.status(502).json({ error: `SC getStats failed: ${(err as Error).message}` });
    }
    return;
  }
  const stats = depositManager.getStats();
  res.json(stats);
});

// ---------------------------------------------------------------------------

/**
 * GET / — serve demo UI
 */
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  const backend = USE_REAL_SC ? '🔗 Qubic SC (real)' : '🧪 In-Memory Mock';
  console.log(`\n  QubicShield Demo Server running at http://localhost:${PORT}`);
  console.log(`  Backend: ${backend}\n`);
  console.log('  Routes:');
  console.log('    POST /api/deposit          – create deposit');
  console.log('    GET  /api/validate/:token  – validate token');
  console.log('    POST /api/refund           – refund deposit');
  console.log('    GET  /api/protected        – access protected resource');
  console.log('    GET  /api/stats            – system statistics');
  console.log('    GET  /                     – demo UI\n');
});

export default app;
