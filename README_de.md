# QubicShield — DDoS-Schutz über wirtschaftliche Kaution

**Status:** Proof of Concept — TypeScript SDK integriert, bereit für Testnet-Deploy  
**Slogan:** „DDoS-Schutz durch wirtschaftliche Anreize — keine Gebühren, sofortige Rückerstattung"  
**Technologie:** Qubic Smart Contract (C++/QPI), Web-Proxy (Node.js/Express), TypeScript

→ **[Vollständiges Konzept & Vision lesen](CONCEPT_de.md)**

---

## Screenshots

| Home  | Simulation | Dashboard |
|---|---|---|
| ![AHome](docs/screenshots/home.png) | ![Simulation](docs/screenshots/simulation.png) | ![Dashboard](docs/screenshots/dashboard.png) |

---

## Die Idee

Ein Nutzer hinterlegt eine kleine QUBIC-Kaution, um Zugang zu einer Website zu erhalten.
Verlässt er sie sauber, wird die Kaution sofort zurückerstattet.
Ein Angreifer mit Millionen von Anfragen müsste für jede einzelne eine Kaution hinterlegen —
wird ein Angriff erkannt, werden alle Kautionen einbehalten.

**Warum Qubic?**  
Auf Ethereum machen Gas-Gebühren Rückerstattungen teurer als die Kaution selbst.
Qubics gebührenfreie Architektur ist die einzige Blockchain, auf der dieses Modell wirtschaftlich funktioniert.

## Ablauf

```
Nutzer                  Qubic Smart Contract        Webserver
  |                            |                        |
  |-- zahlt Kaution (z.B. 10 QUBIC) ->|                |
  |                            |-- hält Kaution          |
  |                            |-- stellt Access-Token aus|
  |-- Access-Token ----------->|                        |
  |                            |               prüft Token
  |<-- Zugang gewährt ---------|                        |
  [... Nutzung ...]
  |-- sauberer Abgang -------->|                        |
  |                            |-- erstattet Kaution     |
  |<-- 10 QUBIC zurück --------|

Bei DDoS:
  Angreifer: 1.000.000 Anfragen → braucht 1.000.000 × Kaution
  → Angriff erkannt → Kautionen einbehalten → Einnahmen für Betreiber
```

## Recherche-Stand (geprüft 2026-03-27)

| Ansatz | Existiert? |
|---|---|
| Dieses Konzept als fertiges Produkt | Nein — nirgendwo gefunden |
| Auf Qubic | Nein |
| Auf Ethereum/EVM | Nein (Gas-Gebühren machen es unwirtschaftlich) |
| Lightning Network | Ähnliche Idee (HTLCs), aber kein Web-Proxy-Produkt |
| Klassischer DDoS-Schutz (Cloudflare etc.) | Ja, aber ohne Krypto-Kautions-Modell |

Ursprung der Idee: verwandt mit Hashcash (Adam Back, 1997) und Lightning-HTLC-Konzepten,
aber nirgendwo als vollständiges Web-Produkt umgesetzt.

## Architektur

### 1. Qubic Smart Contract (`QubicShield.h`)
Hält Kautionen on-chain und erzwingt alle Regeln — kein Server, kein Vertrauen nötig.

| Einstiegspunkt | Typ | Beschreibung |
|---|---|---|
| `Deposit(amount)` | Procedure | QUBIC annehmen, Session-Token ausstellen |
| `Refund(index, token)` | Procedure | QUBIC an legitimen Nutzer zurückgeben |
| `Forfeit(index)` | Procedure | Betreiber zieht Kaution des Angreifers ein |
| `ValidateSession(token)` | Function | Proxy prüft Token-Gültigkeit |
| `GetStats()` | Function | Aggregierte Statistiken |
| `WithdrawForfeited()` | Procedure | Betreiber hebt eingezogene QUBIC ab |
| `SetCreatorAddress(id)` | Procedure | Creator-Wallet setzen/aktualisieren |
| `SetOperator(id)` | Procedure | Betreiber-Rolle übertragen |

Der Session-Ablauf läuft automatisch im `BEGIN_TICK`-Hook (> 2× pro Sekunde, Intervall < 1s).  
`END_EPOCH` verteilt eingezogene QUBIC: **50% werden verbrannt / 50% gehen an den angegriffenen Dienst-Betreiber**.  
Kein Shareholder- oder Plattform-Anteil — wenn es keine DDoS-Angriffe gibt, gibt es auch keine Ausschüttung.

### 2. Web-Proxy / Demo-Server (`src/server.ts`)
Node.js/Express-Server. Unterstützt zwei Backends über die Umgebungsvariable `USE_REAL_SC`:

| Modus | Befehl | Beschreibung |
|---|---|---|
| Mock (Standard) | `npm run dev` | In-Memory-Mock, keine Blockchain nötig |
| Real SC | `USE_REAL_SC=true npm run dev` | Ruft deployed Contract über Qubic RPC auf |

| Route | Beschreibung |
|---|---|
| `POST /api/deposit` | Kaution erstellen |
| `GET /api/validate/:token` | Token validieren |
| `POST /api/refund` | Kaution zurückfordern |
| `GET /api/protected` | Geschützte Ressource aufrufen |
| `GET /api/stats` | System-Statistiken |

### 3. TypeScript SDK Client (`src/scClient.ts`)
Wrapper um `@qubic-lib/qubic-ts-library` v0.1.6 für den deployed SC:
- Procedures: baut, signiert und überträgt `QubicTransaction` via `POST /v1/broadcast-transaction`
- Functions: sendet Base64-kodierte Payload via `POST /v1/querySmartContract`

### 4. Frontend (`public/`)

| URL | Beschreibung |
|---|---|
| `http://localhost:3000/` | API Tester — Kaution, Token, Rückerstattung, Angriffssimulation |
| `http://localhost:3000/demo.html` | Vollautomatische Simulation (im Browser) |
| `http://localhost:3000/dashboard.html` | Live-Dashboard — Sessions, Events, Statistiken |

Alle Seiten teilen eine einheitliche Navigationsleiste (Home · Simulation · Dashboard), ein Server-Status-Badge (grün/rot) und einen DE/EN-Sprachumschalter.

### 5. Dokumentation
- `index.html` — interaktiver zweisprachiger Guide (DE/EN), 18 Abschnitte
- `docs/lernjournal-smart-contract.md` — ausführliches Lernjournal (DE), 20 Kapitel

## Konfigurierbare Parameter

```cpp
MAX_DEPOSITS            512     // max. gleichzeitige Sessions
SESSION_DURATION_TICKS  3600    // < 30 Minuten (> 2 Ticks/Sek., Intervall < 1s)
MIN_DEPOSIT_AMOUNT      10      // Mindestkaution in QUBIC-Einheiten
```

## Geschäftsmodell

| Einnahmequelle | Modell |
|---|---|
| SaaS-Abonnement für Betreiber | 10–100 EUR/Monat |
| Enterprise-Integration | 2.000–10.000 EUR Projekt |
| Qubic Grants | Infrastruktur-Förderung |

> **Hinweis zu eingezogenen Kautionen:** 50% werden verbrannt (deflationär), 50% gehen an den Betreiber des angegriffenen Dienstes.
> Kein Plattform-Anteil by Design — das Geschäftsmodell basiert auf Abonnements, nicht auf dem Stattfinden von Angriffen.

## Risiken & Offene Fragen

### Produkt / Rechtliches
- **UX-Hürde:** Nutzer brauchen eine Wallet — hohe Einstiegshürde für Mainstream-Adoption
- **Rechtliches:** Einzugsbedingungen müssen in den AGB abgedeckt sein
- **Patent:** Prüfen, ob ähnliche Konzepte patentiert sind
- **QUBIC-Preisvolatilität:** Kautionswert schwankt → USD-pegged-Logik in Betracht ziehen
- **False Positives:** Ein legitimer Nutzer könnte fälschlicherweise als Angreifer erkannt werden und seine Kaution verlieren. Kein Einspruchs- oder Beschwerdeprozess vorhanden.

### Bekannte technische Probleme

**1. Epochenwechsel (jeden Mittwoch ~12:00 UTC)**  
Das Qubic-Netzwerk startet bei jedem wöchentlichen Epochenwechsel neu. Der Ausfall kann bis zu 45 Minuten dauern. Die aktuelle Retry-Logik in `scClient.ts` deckt nur 5 × 8 s = 40 Sekunden ab — bei weitem zu kurz. Während des Ausfalls gibt der Server 502-Fehler zurück. Ein Fallback-Modus (z.B. Weiterbetrieb mit Mock-Validierung) ist nicht implementiert. Das Qubic-Team arbeitet daran, diese Ausfallzeit zu reduzieren.

**2. Leere Ticks (stille Transaktion-Verwerfung)**  
Qubic-Ticks produzieren gelegentlich keinen Block. Eine Transaktion, die in so einen Tick gesendet wird, wird stillschweigend verworfen. `scClient.ts` erkennt veraltete Ticks serverseitig und wiederholt den Versuch bis zu 5-mal. Der Client erhält jedoch nur eine `txId` zurück und muss `/api/validate/<token>` manuell pollen. Landen alle Versuche in leeren Ticks, wird der Deposit nie bestätigt und der Nutzer wartet ohne automatische Wiederherstellung.

**3. On-Chain Forfeit wird im SC-Modus nicht aufgerufen** ⚠️ Blocker für Testnet  
Die Angriffserkennung läuft lokal im Server. Wenn ein Angriff erkannt wird, aktualisiert `depositManager.forfeitDeposit()` nur den Mock-Zustand — die `Forfeit()`-Procedure im Smart Contract wird nie aufgerufen. Im SC-Modus behält ein Angreifer seine Kaution on-chain, egal was der Server erkennt. Dies muss vor einem sinnvollen Testnet-Test implementiert werden.

**4. Forfeit-Aufteilung noch nicht festgelegt**  
Die aktuelle Implementierung verwendet 50% verbrennen / 50% Operator. Das Lernjournal dokumentiert ein alternatives Modell (40% verbrennen / 40% Shareholder / 15% Operator / 1% Creator). Die Aufteilung muss vor dem Testnet-Deploy entschieden und der Contract entsprechend aktualisiert werden.

**5. Session-Slot-Limit**  
`MAX_DEPOSITS = 512` ist ein PoC-Wert. Wenn alle Slots belegt sind, werden neue Deposits mit einem kryptischen Fehlercode abgelehnt. Kein Warteschlangen-Mechanismus, keine Überlaufstrategie und keine benutzerfreundliche Fehlermeldung sind implementiert.

**6. Event-Log im SC-Modus nicht verfügbar**  
`GET /api/events` funktioniert nur im Mock-Modus. Im echten SC-Modus gibt es keinen Audit-Trail für Deposits, Rückerstattungen oder Konfiszierungsentscheidungen.

## Schnellstart

```bash
# Repository klonen und Abhängigkeiten installieren
git clone <repo-url>
cd qubicshield-ddos
npm install

# Tests ausführen (alle 56 müssen grün sein)
npm test

# Entwicklungsserver starten
npm run dev
# → http://localhost:3000
```

Ein grünes Badge oben rechts auf jeder Seite bestätigt, dass der Server läuft.

### Konsolen-Demo (optional, zweites Terminal)

```bash
# Terminal 1 — Server starten
npm run dev

# Terminal 2 — Konsolen-Demo (braucht laufenden Server)
npm run demo
```

`npm run demo` simuliert den vollständigen Ablauf: Kaution erstellen → Token validieren → geschützte Route aufrufen → Rückerstattung anfordern → DDoS-Angriff → Konfiszierung → Statistiken.

### Real SC Modus (nach Testnet-Deploy)

`.env`-Datei mit den Werten aus dem Deploy anlegen:

```env
SC_ADDRESS=<60-stellige Contract Public ID>
SC_INDEX=<numerischer Contract-Index>
QUBIC_RPC=https://testnet-rpc.qubic.org
```

Dann starten:

```bash
USE_REAL_SC=true npm run dev
```

## GitHub Pages

Die Root-`index.html` (interaktiver Guide) ist eine statische Datei und funktioniert auf GitHub Pages ohne Server.  
Pages in den Repository-Einstellungen aktivieren (Source: Branch `main`, Root `/`) — fertig.

> **Hinweis:** Die Web-App unter `public/` (API Tester, Simulation, Dashboard) benötigt den laufenden Express-Server für alle API-Aufrufe. Die Seiten werden auf GitHub Pages gerendert, aber alle API-Interaktionen schlagen ohne Server fehl.

## Nächste Schritte

### Vor dem Testnet-Deploy
- [ ] Forfeit-Aufteilung festlegen (50/50 vs. 40/40/15/1) und `QubicShield.h` aktualisieren
- [ ] On-Chain `Forfeit()`-Aufruf in `server.ts` implementieren, wenn ein Angriff erkannt wird
- [ ] Qubic Community / Team kontaktieren — Projekt im Discord (#developers) vorstellen, Feedback einholen, Testnet-Deploy-Prozess klären

### Testnet
- [ ] `QubicShield.h` auf Qubic Testnet deployen
- [ ] `SC_ADDRESS` und `SC_INDEX` in `.env` setzen
- [ ] End-to-End-Tests gegen den deployed Contract ausführen

### Production Readiness
- [ ] Retry-Fenster für Epochenwechsel (> 45 Min) erweitern oder Fallback-Modus implementieren
- [ ] Serverseitiges Deposit-Bestätigungs-Polling implementieren, damit Clients keine Retries selbst verwalten müssen
- [ ] False-Positive-Einspruchs- / Beschwerdeprozess einführen
- [ ] `MAX_DEPOSITS` über 512 erhöhen und Überlaufbehandlung hinzufügen
- [ ] Event-Log für SC-Modus implementieren (On-Chain Audit-Trail)

## Quellen
- [Qubic QPI Dokumentation](https://docs.qubic.org/developers/qpi/)
- [Hashcash — Adam Back, 1997](http://www.hashcash.org/papers/hashcash.pdf)
- [Lightning Network HTLCs](https://lightning.network/lightning-network-paper.pdf)

## Lizenz

Da wir Teile des 451-Pakets (`@qubic-lib/qubic-ts-library`) für das Signieren und Senden von Qubic-Transaktionen verwenden, gilt auch die Anti-Military License. Siehe https://github.com/computor-tools/qubic-crypto

Der QubicShield-Quellcode (Smart Contract, Web-Proxy, TypeScript SDK) steht unter der AGPL-3.0-Lizenz. Der Quellcode darf für geschäftliche Zwecke genutzt werden.
