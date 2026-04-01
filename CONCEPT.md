# QubicShield — Concept & Vision

> **"Whoever acts legitimately pays nothing. Whoever attacks loses everything."**

**Status:** Proof of Concept  
**Stage:** Looking for community feedback, testnet collaboration, and Qubic Foundation grant

---

## The Problem

DDoS attacks are one of the oldest unsolved problems on the internet.

The current answer is **technical filtering** — companies like Cloudflare sit between attackers and servers, absorbing traffic and filtering out bad requests. It works, but it has a fundamental flaw:

- Expensive — monthly subscription regardless of whether you're being attacked
- Centralized — Cloudflare sees every request from every user
- Reactive — the attack happens first, then gets filtered
- Single point of failure — Cloudflare outages take down thousands of sites at once

**The root cause is never addressed:** attacking is cheap. An attacker with a botnet of 100,000 devices pays almost nothing to flood a server with millions of requests.

---

## The Insight

What if attacking became economically irrational?

Not more technology against attacks — but an economic incentive that makes attacks not worth doing in the first place.

> **Every request requires a small deposit. Legitimate users get it back instantly. Attackers lose it.**

This idea is related to Hashcash (Adam Back, 1997) and Lightning Network HTLCs — but has never been realized as a complete, working web product. Anywhere.

---

## Why Only Qubic Makes This Work

On Ethereum, every transaction costs gas fees. A deposit of $0.10 would cost more in fees to refund than the deposit itself — the model collapses economically.

**Qubic has zero transaction fees.**

That is the entire reason this is possible. A refund costs nothing. A 1 QU deposit costs nothing to return. The model works at any scale, including micropayments.

No other blockchain makes this economically viable.

---

## How It Works

```
User                    Qubic Smart Contract        Web Server
  |                            |                        |
  |-- pays deposit (10 QUBIC) →|                        |
  |                            |-- holds deposit         |
  |                            |-- issues access token   |
  |-- Access Token ───────────────────────────────────→ |
  |                                              validates token
  |←── Access granted ──────────────────────────────── |
  [... normal usage ...]
  |-- clean exit ──────────────→|                       |
  |                            |-- refunds deposit       |
  |←── 10 QUBIC returned ──────|

On DDoS attack:
  Attacker: 1,000,000 requests → needs 1,000,000 × deposit upfront
  → attack detected → all deposits forfeited → attacker loses funds
```

The smart contract is the single source of truth. No server, no trust required.

### What Happens to Forfeited Deposits

```
50% → burned           (permanently removed from supply — deflationary)
50% → attacked operator (direct compensation for the damage)
 0% → platform          (no conflict of interest)
```

No platform share by design. The business model does not depend on attacks happening.

---

## The Vision: The End of DDoS

> **If QubicShield works, there will be almost no QU to burn.**

That sounds paradoxical — but it is the proof of success.

A rational attacker calculates:

```
Cost of attack   = deposit × number of requests
Benefit of attack = damage to the victim

Once cost > benefit → attack does not happen
```

The goal is not to filter attacks. The goal is that they never start.

```
Today:     internet traffic = legitimate traffic + attack traffic (noise)
Tomorrow:  internet traffic = almost entirely legitimate traffic

→ Servers need less capacity
→ Load times decrease
→ Hosting costs decrease
→ Energy wasted on useless attack packets disappears
```

---

## The Path to an Internet Standard

QubicShield is not just a product. The long-term goal is an open internet standard — like HTTPS, like Passkeys.

```
Today        Optional add-on for API providers and developers

Growth       Browser extension, SDKs, growing brand awareness
             Websites adopt it voluntarily

Standard     W3C / IETF: QubicShield as an open protocol
             Browsers integrate it natively

World standard  Every device carries a wallet — automatically
                DDoS attacks become economically irrational, everywhere
```

HTTPS was optional for years. Passkeys were natively integrated by Apple, Google, and Microsoft in 2022 — because they became an open standard. Same model, same path.

---

## Use Cases

### 1. Developer calling an API directly

```bash
# One-time setup
qubicshield deposit --service api.example.com --amount 1000

# Daily usage — token injected automatically
curl https://api.example.com/data \
  -H "X-QubicShield-Token: $(qubicshield token --service api.example.com)"
```

Like an API key — but it comes from a wallet and burns on misuse instead of just being revoked.

### 2. Server calling an external API

When Website A calls API B on every page load, a DDoS flood on A automatically triggers mass requests to B. B blocks A. Legitimate users get errors.

With QubicShield, Website A deposits with B's smart contract once. Both sides have skin in the game — both protect themselves.

### 3. End users in the browser

A browser extension holds a small QU wallet and handles everything automatically in the background. The user sees nothing except a shield icon in the toolbar.

Long term: native browser integration, like the password manager or the HTTPS lock.

---

## Research: Has This Been Done Before?

| Approach | Exists? |
|---|---|
| This concept as a finished product | **No — not found anywhere** |
| On Qubic | No |
| On Ethereum/EVM | No — gas fees make it uneconomical |
| Lightning Network | Similar mechanics (HTLCs), but no web proxy product |
| Cloudflare / Akamai | Technical filtering — no economic deposit model |
| Academic research | Discussed conceptually, never production-ready |

The idea connects to Hashcash (1997) and Lightning HTLCs — but the complete combination of refundable deposit + web access + DDoS protection + forfeit on detection has not been built as a product anywhere.

---

## QubicShield vs. Cloudflare

| | Cloudflare | QubicShield |
|---|---|---|
| Approach | Technology filters attacks | Economics prevents attacks |
| Architecture | Centralized | Decentralized |
| Traffic visibility | Cloudflare sees everything | No traffic routing needed |
| Single point of failure | Yes | No |
| Cost when no attack | Monthly subscription | Near zero |
| Privacy | Your traffic passes through their servers | GDPR-friendly by design |
| Long-term goal | Manage attacks | Make attacks irrational |

For organizations using Cloudflare only for DDoS: QubicShield is a full replacement — decentralized, cheaper, private.

---

## Current Status

This is a working Proof of Concept:

- **Smart Contract** (`QubicShield.h`) — written in C++/QPI, ready for testnet deploy
- **Web Proxy** (`src/server.ts`) — Node.js/Express, mock and real SC mode
- **TypeScript SDK** (`src/scClient.ts`) — wraps `@qubic-lib/qubic-ts-library`
- **Frontend** — API Tester, automated simulation, live dashboard
- **Tests** — 56 tests, all passing
- **Documentation** — interactive bilingual guide (DE/EN) at `index.html`

What works in mock mode works. The next step is testnet deploy and end-to-end validation against a real smart contract.

### Known Limitations (honest disclosure)

- **Epoch change** — weekly network restart (~45 min outage) exceeds current retry window. The Qubic team is working on this.
- **On-chain forfeit** not yet called when attack detected — testnet blocker, must be implemented.
- **Empty ticks** — transactions may be silently dropped and need client-side retry.
- **Forfeit split** — 50/50 vs. 40/40/15/1 model not yet finalized.

Full list in [README.md — Known Technical Problems](README.md).

---

## Business Model

QubicShield is open source. The smart contract is on GitHub. Anyone can read it, fork it, audit it.

Trust requires transparency. An open standard can only be built on open code.

| Revenue | Model |
|---|---|
| Qubic Foundation Grant | Funding for PoC and initial development |
| Managed services (optional) | Hosted dashboard, managed nodes, integration support — the core stays free |
| Enterprise integration | Custom deployment, SLA, support |

The core protocol is and remains free. Revenue comes from services around it, not from the protocol itself.

---

## Call to Action

This project is looking for:

**Qubic community developers**
- Test the PoC, try `npm run dev`, open issues, send PRs
- Help with the testnet deploy

**Qubic Foundation**
- Feedback on the concept
- Grant application discussion — is this the kind of infrastructure the ecosystem needs?

**Anyone who runs a web service**
- Would you use this? What would you need?
- What deposit amount would make sense for your use case?

**Discord:** #developers on the Qubic Discord  
**GitHub:** Open an issue or start a discussion

---

## Sources

- [Qubic QPI Documentation](https://docs.qubic.org/developers/qpi/)
- [Hashcash — Adam Back, 1997](http://www.hashcash.org/papers/hashcash.pdf)
- [Dwork & Naor 1993 — Pricing via Processing](https://gwern.net/doc/bitcoin/1993-dwork.pdf)
- [Lightning Network HTLCs](https://lightning.network/lightning-network-paper.pdf)
- [Proof of Work as DDoS mitigation — HTTPWG](https://github.com/httpwg/http-core/issues/935)
