import { Request, Response, NextFunction } from 'express';

interface WindowEntry {
  timestamps: number[];
}

/**
 * In-memory sliding-window rate limiter per access token.
 *
 * Attaches `res.locals.isAttacking = true` and returns 429 when a token
 * exceeds RATE_LIMIT requests within WINDOW_MS milliseconds.
 *
 * The DepositManager has its own parallel counter; this middleware acts as
 * a first layer before the route handler, allowing the route to also call
 * depositManager.isAttacking() for the forfeiture decision.
 */

const WINDOW_MS = 60_000; // 60 seconds
const RATE_LIMIT = 50;    // requests per window before flagging

const windows: Map<string, WindowEntry> = new Map();

function extractToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (!token) {
    next();
    return;
  }

  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let entry = windows.get(token);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(token, entry);
  }

  // Slide the window: remove entries older than WINDOW_MS
  entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
  entry.timestamps.push(now);

  const requestsInWindow = entry.timestamps.length;
  const isAttacking = requestsInWindow > RATE_LIMIT;

  // Expose to downstream route handlers via res.locals
  res.locals['isAttacking'] = isAttacking;
  res.locals['requestsInWindow'] = requestsInWindow;

  if (isAttacking) {
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Window', `${WINDOW_MS / 1000}s`);
    // We do NOT immediately 429 here; the route decides whether to forfeit
    // the deposit first. Just mark and continue.
  } else {
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT - requestsInWindow)));
    res.setHeader('X-RateLimit-Window', `${WINDOW_MS / 1000}s`);
  }

  next();
}
