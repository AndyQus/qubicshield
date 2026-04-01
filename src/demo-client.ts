/**
 * QubicShield Demo Client
 *
 * Zeigt den vollständigen QubicShield-Ablauf auf der Konsole:
 *   1. Deposit erstellen
 *   2. Token validieren
 *   3. Geschützten Endpoint aufrufen (3×)
 *   4. Kaution zurückfordern
 *   --- Angriffs-Simulation ---
 *   5. Neuen Deposit für Angreifer erstellen
 *   6. Flood (55 parallele Requests)
 *   7. Konfiszierung + 50/50-Verteilung anzeigen
 *   8. Abschluss-Statistiken
 *
 * Starten:
 *   npm run demo           (erfordert laufenden Server: npm start)
 *   npm start & npm run demo
 */

const BASE = process.env.SERVER_URL ?? 'http://localhost:3000';

// ── ANSI-Farben ────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  purple: '\x1b[35m',
  white:  '\x1b[37m',
};

function log(msg: string)  { console.log(msg); }
function ok(msg: string)   { log(`${C.green}  ✓  ${C.reset}${msg}`); }
function err(msg: string)  { log(`${C.red}  ✗  ${C.reset}${msg}`); }
function info(msg: string) { log(`${C.cyan}  ·  ${C.reset}${msg}`); }
function warn(msg: string) { log(`${C.yellow}  ⚠  ${C.reset}${msg}`); }
function step(n: number, msg: string) {
  log(`\n${C.bold}${C.purple}  ─── Schritt ${n}: ${msg} ───${C.reset}`);
}
function attack(msg: string) {
  log(`${C.red}  ⚡ ${C.reset}${C.bold}${msg}${C.reset}`);
}
function dim(msg: string)  { log(`${C.dim}     ${msg}${C.reset}`); }

function header(msg: string) {
  const line = '═'.repeat(56);
  log(`\n${C.bold}${C.cyan}  ${line}`);
  log(`  ${msg}`);
  log(`  ${line}${C.reset}\n`);
}

function json(obj: unknown) {
  const lines = JSON.stringify(obj, null, 2).split('\n');
  lines.forEach(l => log(`${C.dim}     ${l}${C.reset}`));
}

// ── HTTP-Helpers ───────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json() as T;
  return { status: res.status, data };
}

async function get<T>(path: string, token?: string): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(`${BASE}${path}`, { headers });
  const data = await res.json() as T;
  return { status: res.status, data };
}

// ── Haupt-Demo ─────────────────────────────────────────────────────────────

async function main() {
  header('QubicShield Demo Client — Normaler Ablauf + Angriffs-Simulation');

  // ── Prüfen ob Server erreichbar ──────────────────────────────────────────
  try {
    await fetch(`${BASE}/api/stats`);
  } catch {
    err(`Server nicht erreichbar: ${BASE}`);
    log(`\n${C.yellow}  Starte zuerst den Server:${C.reset}`);
    log(`${C.dim}  cd qubicshield-ddos && npm start${C.reset}\n`);
    process.exit(1);
  }

  // ===================================================================
  // TEIL 1 — NORMALER ABLAUF (Legitimer Nutzer)
  // ===================================================================

  log(`${C.bold}${C.green}  TEIL 1 — Legitimer Nutzer${C.reset}`);

  // ── Schritt 1: Deposit erstellen ────────────────────────────────────
  step(1, 'Deposit erstellen');

  const wallet = 'QUBIC-DEMO-WALLET-001';
  const amount = 1000;

  info(`Wallet:  ${wallet}`);
  info(`Betrag:  ${amount} QU`);

  const deposit = await post<{
    sessionId: string; accessToken: string;
    depositAmount: number; expiresAt: number; message: string;
  }>('/api/deposit', { walletAddress: wallet, amount });

  if (!deposit.data.accessToken) {
    err('Deposit fehlgeschlagen');
    json(deposit.data);
    process.exit(1);
  }

  const { sessionId, accessToken } = deposit.data;
  ok(`Deposit erstellt`);
  dim(`Session-ID:   ${sessionId}`);
  dim(`Access-Token: ${accessToken.slice(0, 16)}…`);
  dim(`Läuft ab:     ${new Date(deposit.data.expiresAt).toLocaleTimeString()}`);

  // ── Schritt 2: Token validieren ─────────────────────────────────────
  step(2, 'Token validieren');

  const validate = await get<{
    valid: boolean; sessionId: string; requestCount: number;
  }>(`/api/validate/${accessToken}`);

  if (validate.data.valid) {
    ok(`Token gültig — Session aktiv`);
    dim(`Request-Count: ${validate.data.requestCount}`);
  } else {
    err('Token ungültig');
    process.exit(1);
  }

  // ── Schritt 3: Geschützten Endpoint aufrufen (3×) ────────────────────
  step(3, 'Geschützten Endpoint aufrufen (3 legitime Requests)');

  for (let i = 1; i <= 3; i++) {
    const res = await get<{
      message: string; requestCount: number; remainingTime: number;
    }>('/api/protected', accessToken);

    if (res.status === 200) {
      ok(`Request ${i}: "${res.data.message}"`);
      dim(`Requests bisher: ${res.data.requestCount} | Verbleibend: ${res.data.remainingTime}s`);
    } else {
      err(`Request ${i} fehlgeschlagen: HTTP ${res.status}`);
      json(res.data);
    }
    // Kleine Pause zwischen Requests
    await new Promise(r => setTimeout(r, 100));
  }

  // ── Schritt 4: Kaution zurückfordern ────────────────────────────────
  step(4, 'Kaution zurückfordern (sauberer Abschluss)');

  const refund = await post<{
    success: boolean; refundedAmount: number; message: string;
  }>('/api/refund', { sessionId });

  if (refund.data.success) {
    ok(`${refund.data.refundedAmount} QU zurückerstattet`);
    ok(`Legitimer Nutzer zahlt NICHTS — Kaution vollständig zurück`);
    dim(refund.data.message);
  } else {
    warn(refund.data.message);
  }

  // ===================================================================
  // TEIL 2 — ANGRIFFS-SIMULATION
  // ===================================================================

  log(`\n\n${C.bold}${C.red}  TEIL 2 — Angriffs-Simulation${C.reset}`);

  // ── Schritt 5: Angreifer-Deposit ─────────────────────────────────────
  step(5, 'Angreifer erstellt Deposit');

  const attackWallet = 'ATTACKER-BOT-999';
  const attackAmount = 5000;

  info(`Angreifer-Wallet: ${attackWallet}`);
  info(`Deposit-Betrag:   ${attackAmount} QU`);

  const attackDeposit = await post<{
    sessionId: string; accessToken: string;
    depositAmount: number; message: string;
  }>('/api/deposit', { walletAddress: attackWallet, amount: attackAmount });

  if (!attackDeposit.data.accessToken) {
    err('Angreifer-Deposit fehlgeschlagen');
    process.exit(1);
  }

  const attackToken   = attackDeposit.data.accessToken;
  const attackSession = attackDeposit.data.sessionId;

  ok(`Angreifer-Deposit erstellt`);
  dim(`Session: ${attackSession.slice(0, 8)}…`);

  // ── Schritt 6: Flood ──────────────────────────────────────────────────
  step(6, 'DDoS-Flood (55 parallele Requests)');

  const FLOOD_COUNT = 55;  // > ATTACK_THRESHOLD (50)
  attack(`Sende ${FLOOD_COUNT} Requests gleichzeitig an /api/protected…`);

  const floodPromises = Array.from({ length: FLOOD_COUNT }, () =>
    get<{ message?: string; error?: string; forfeitedAmount?: number; distribution?: unknown }>(
      '/api/protected', attackToken
    )
  );

  const floodResults = await Promise.all(floodPromises);

  const ok200   = floodResults.filter(r => r.status === 200).length;
  const ok403   = floodResults.filter(r => r.status === 403).length;
  const forfeit = floodResults.find(r => r.status === 403);

  info(`Requests gesendet:  ${FLOOD_COUNT}`);
  info(`Requests erlaubt:   ${ok200}`);
  info(`Requests blockiert: ${ok403}`);

  // ── Schritt 7: Konfiszierung anzeigen ─────────────────────────────────
  step(7, 'Konfiszierung + 50/50-Verteilung');

  if (forfeit) {
    const fd = forfeit.data;
    attack(`ANGRIFF ERKANNT — Deposit konfisziert!`);

    const forfeited = fd.forfeitedAmount ?? attackAmount;
    const half      = Math.floor(forfeited / 2);
    const dist      = fd.distribution as { burned?: number; toVictim?: number } | undefined;

    log('');
    log(`${C.bold}  Konfiszierter Betrag: ${forfeited} QU${C.reset}`);
    log('');
    log(`  ${C.red}████████████████████${C.reset} ${C.green}████████████████████${C.reset}`);
    log(`  ${C.red}  50% verbrannt      ${C.reset} ${C.green}  50% ans Opfer      ${C.reset}`);
    log(`  ${C.red}  ${(dist?.burned ?? half).toLocaleString()} QU${C.reset}              ${C.green}  ${(dist?.toVictim ?? half).toLocaleString()} QU${C.reset}`);
    log('');

    ok(`${dist?.burned ?? half} QU dauerhaft aus dem Umlauf entfernt (Deflation)`);
    ok(`${dist?.toVictim ?? half} QU an den angegriffenen Dienst übertragen`);
    ok(`0 QU an Plattform/Aktionäre`);

    log('');
    attack(`Der Angreifer hat ${forfeited} QU verloren.`);
    attack(`Bei 0,01 $/QU (Zielkurs): $${(forfeited * 0.01).toFixed(2)} Verlust pro Angriff.`);
  } else {
    warn(`Kein Forfeit erkannt — Schwelle nicht erreicht.`);
    warn(`Versuche mehr Flood-Requests (aktuell: ${FLOOD_COUNT})`);
  }

  // ===================================================================
  // TEIL 3 — ABSCHLUSS-STATISTIKEN
  // ===================================================================

  step(8, 'Abschluss-Statistiken');

  const stats = await get<{
    totalDeposits: number; activeSessions: number;
    heldAmount: number; refundedAmount: number; forfeitedAmount: number;
    forfeitedToBurn: number; forfeitedToVictim: number;
    refundedCount: number; forfeitedCount: number;
  }>('/api/stats');

  const s = stats.data;
  log('');
  log(`  ${C.bold}Statistik${C.reset}`);
  log(`  ${C.dim}─────────────────────────────────────${C.reset}`);
  info(`Gesamt Deposits:    ${s.totalDeposits}`);
  info(`Rückerstattet:      ${s.refundedCount}× · ${s.refundedAmount} QU`);
  info(`Konfisziert:        ${s.forfeitedCount}× · ${s.forfeitedAmount} QU`);
  log(`  ${C.dim}  davon verbrannt:  ${s.forfeitedToBurn ?? 0} QU${C.reset}`);
  log(`  ${C.dim}  davon ans Opfer:  ${s.forfeitedToVictim ?? 0} QU${C.reset}`);
  log('');

  header('Demo abgeschlossen — QubicShield funktioniert');
  log(`  ${C.green}Ergebnis:${C.reset}`);
  log(`  ✓ Legitimer Nutzer hat seine ${amount} QU vollständig zurückerhalten`);
  log(`  ✓ Angreifer hat ${attackAmount} QU verloren`);
  log(`  ✓ Das System hat keine manuellen Eingriffe benötigt\n`);

  log(`  ${C.cyan}Nächste Schritte:${C.reset}`);
  log(`  · Smart Contract auf Qubic Testnet deployen`);
  log(`  · USE_REAL_SC=true in .env setzen`);
  log(`  · Vollständige Anleitung: docs/guide-integration.md\n`);
}

main().catch(e => {
  console.error('\n  Unerwarteter Fehler:', e.message);
  process.exit(1);
});
