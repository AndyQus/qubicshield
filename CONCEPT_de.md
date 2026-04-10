# QubicShield — Konzept & Vision

> **"Wer legitim ist, zahlt nichts. Wer angreift, verliert alles."**

**Status:** Proof of Concept  
**Ziel:** Community-Feedback, Testnet-Zusammenarbeit, Qubic Foundation Grant

---

## Das Problem

DDoS-Angriffe sind eines der ältesten ungelösten Probleme des Internets.

Die aktuelle Antwort ist **technisches Filtern** — Unternehmen wie Cloudflare sitzen zwischen Angreifern und Servern, nehmen den Traffic auf und filtern schlechte Anfragen heraus. Es funktioniert, hat aber einen grundlegenden Fehler:

- Teuer — monatliches Abo unabhängig davon, ob angegriffen wird
- Zentralisiert — Cloudflare sieht jede Anfrage jedes Nutzers
- Reaktiv — der Angriff findet zuerst statt, dann wird gefiltert
- Single Point of Failure — Cloudflare-Ausfälle legen tausende Seiten gleichzeitig lahm

**Die eigentliche Ursache wird nie behoben:** Angreifen ist billig. Ein Angreifer mit einem Botnet aus 100.000 Geräten zahlt fast nichts, um einen Server mit Millionen von Anfragen zu überfluten.

---

## Die Erkenntnis

Was wäre, wenn Angreifen wirtschaftlich irrational würde?

Nicht mehr Technik gegen Angriffe — sondern ein wirtschaftlicher Anreiz, der Angriffe von vornherein unwirtschaftlich macht.

> **Jede Anfrage erfordert eine kleine Kaution. Legitime Nutzer bekommen sie sofort zurück. Angreifer verlieren sie.**

Diese Idee ist verwandt mit Hashcash (Adam Back, 1997) und Lightning-Network-HTLCs — wurde aber nirgendwo als vollständiges, funktionierendes Webprodukt umgesetzt. Nirgendwo.

---

## Warum nur Qubic das möglich macht

Auf Ethereum kostet jede Transaktion Gas-Gebühren. Eine Kaution von 0,10 EUR würde mehr Gebühren bei der Rückzahlung kosten als die Kaution selbst — das Modell bricht wirtschaftlich zusammen.

**Qubic hat keine Transaktionsgebühren.**

Das ist der einzige Grund, warum das funktioniert. Eine Rückzahlung kostet nichts. Eine Kaution von 1 QU kostet nichts zurückzugeben. Das Modell funktioniert in jeder Größenordnung, auch für Mikrozahlungen.

Keine andere Blockchain macht das wirtschaftlich realisierbar.

---

## Wie es funktioniert

```
Nutzer                  Qubic Smart Contract        Webserver
  |                            |                        |
  | (0. Schlüssel aus Seed ableiten — lokal, nie gesendet)
  |-- zahlt Kaution + PublicKey →|                      |
  |                            |-- hält Kaution          |
  |                            |-- speichert PublicKey   |
  |                            |-- stellt Token aus      |
  |-- Token + SchnorrQ-Signatur ───────────────────────→ |
  |                                  prüft Signatur      |
  |                                  (PublicKey aus SC)  |
  |←── Zugang gewährt ──────────────────────────────── |
  [... jede Anfrage signiert — gestohlenes Token ohne Privatschlüssel nutzlos ...]
  |-- sauberer Abgang ─────────→|                       |
  |                            |-- gibt Kaution zurück   |
  |←── 10 QU zurück ───────────|

Bei Angriff:
  Angreifer: 1.000.000 Anfragen → braucht 1.000.000 × Kaution vorab
  → Angriff erkannt + Signaturen geprüft → alle Kautionen eingezogen → Angreifer verliert Geld
```

Der Smart Contract ist die einzige Wahrheitsquelle. Kein Server, kein Vertrauen nötig.

### Was mit eingezogenen Kautionen passiert

```
50% → verbrannt          (dauerhaft aus dem Umlauf entfernt — deflationär)
50% → angegriffener Betreiber (direkte Entschädigung für den Schaden)
 0% → Plattform           (kein Interessenskonflikt)
```

Kein Plattformanteil by Design. Das Geschäftsmodell hängt nicht davon ab, dass Angriffe stattfinden.

---

## Die Vision: Das Ende von DDoS

> **Wenn QubicShield funktioniert, wird es kaum noch QU zu verbrennen geben.**

Das klingt paradox — ist aber der Beweis für Erfolg.

Ein rationaler Angreifer rechnet:

```
Kosten des Angriffs  = Kaution × Anzahl Anfragen
Nutzen des Angriffs  = Schaden beim Opfer

Sobald Kosten > Nutzen → Angriff findet nicht statt
```

Das Ziel ist nicht, Angriffe zu filtern. Das Ziel ist, dass sie gar nicht erst stattfinden.

```
Heute:    Internet-Traffic = legitimer Traffic + Angriffs-Traffic (Lärm)
Morgen:   Internet-Traffic = fast ausschließlich legitimer Traffic

→ Server brauchen weniger Kapazität
→ Ladezeiten sinken
→ Hosting-Kosten sinken
→ Energie für nutzlose Angriffspakete entfällt
```

---

## Der Weg zum Internet-Standard

QubicShield ist nicht nur ein Produkt. Das langfristige Ziel ist ein offener Internet-Standard — wie HTTPS, wie Passkeys.

```
Heute         Optionaler Zusatz für API-Anbieter und Entwickler

Wachstum      Browser-Extension, SDKs, wachsende Bekanntheit
              Webseiten aktivieren es freiwillig

Standard      W3C / IETF: QubicShield als offenes Protokoll
              Browser integrieren es nativ

Weltstandard  Jedes Gerät bringt eine Wallet mit — automatisch
              DDoS-Angriffe werden wirtschaftlich irrational, überall
```

HTTPS war jahrelang optional. Passkeys wurden 2022 von Apple, Google und Microsoft nativ integriert — weil sie ein offener Standard wurden. Gleiches Modell, gleicher Weg.

---

## Anwendungsfälle

### 1. Entwickler ruft eine API direkt auf

```bash
# Einmalige Einrichtung
qubicshield deposit --service api.example.com --amount 1000

# Tägliche Nutzung — Token wird automatisch eingefügt
curl https://api.example.com/daten \
  -H "X-QubicShield-Token: $(qubicshield token --service api.example.com)"
```

Wie ein API-Key — aber er kommt aus einer Wallet und verbrennt bei Missbrauch statt nur gesperrt zu werden.

### 2. Server ruft externe API auf

Wenn Website A bei jedem Seitenaufruf eine externe API B aufruft, löst eine DDoS-Flut auf A automatisch Massenanfragen an B aus. B sperrt A. Legitime Nutzer bekommen Fehler.

Mit QubicShield hinterlegt Website A einmalig eine Kaution beim Smart Contract von B. Beide Seiten haben etwas zu verlieren — beide schützen sich selbst.

### 3. Endnutzer im Browser

Eine Browser-Extension hält ein kleines QU-Wallet und erledigt alles automatisch im Hintergrund. Der Nutzer sieht nichts außer einem Shield-Symbol in der Toolbar.

Langfristig: native Browser-Integration, wie der Passwort-Manager oder das HTTPS-Schloss.

---

## Recherche: Wurde das schon umgesetzt?

| Ansatz | Existiert? |
|---|---|
| Dieses Konzept als fertiges Produkt | **Nein — nirgendwo gefunden** |
| Auf Qubic | Nein |
| Auf Ethereum/EVM | Nein — Gas-Gebühren machen es unwirtschaftlich |
| Lightning Network | Ähnliche Mechanik (HTLCs), aber kein Web-Proxy-Produkt |
| Cloudflare / Akamai | Technisches Filtern — kein wirtschaftliches Kautions-Modell |
| Akademische Forschung | Konzeptuell diskutiert, nie produktionsreif |

Die Idee verbindet Hashcash (1997) und Lightning HTLCs — aber die vollständige Kombination aus rückzahlbarer Kaution + Web-Zugang + wirtschaftlichem Spam-Schutz + Konfiszierung bei Erkennung wurde nirgendwo als Produkt gebaut.

---

## QubicShield vs. Cloudflare

| | Cloudflare | QubicShield |
|---|---|---|
| Ansatz | Technik filtert Angriffe | Wirtschaft verhindert Angriffe |
| Architektur | Zentralisiert | Dezentral |
| Traffic-Sichtbarkeit | Cloudflare sieht alles | Kein Traffic-Routing nötig |
| Single Point of Failure | Ja | Nein |
| Kosten ohne Angriff | Monatliches Abo | Nahezu nichts |
| Datenschutz | Traffic läuft über fremde Server | DSGVO-konform by Design |
| Langfristziel | Angriffe managen | Angriffe irrational machen |

Für Unternehmen, die Cloudflare primär für Rate Limiting und API-Schutz nutzen: QubicShield ist eine überzeugende Alternative — dezentral, günstiger, datenschutzfreundlicher. Für volumetrischen Netzwerk-DDoS-Schutz ist QubicShield eher ergänzend als ersetzend (siehe Langzeit-Vision zum Shield-Node-Netz).

---

## QubicShield vs. QubicShield Node

QubicShield und das QubicShield-Node-Konzept sind keine Konkurrenten — das eine ist das Protokoll, das andere ist die Infrastruktur.

**QubicShield (dieses Projekt)** läuft als Middleware direkt im Web-Server. Kein Node nötig.

```
Internet
   │
Web-Server (Node.js)
  └── QubicShield Middleware
        ├── Deposit-Check (SC-Call)
        ├── SchnorrQ-Signatur-Prüfung
        └── Forfeit bei erkanntem Angriffsmuster
   │
Geschützte API / Ressource
```

**Einschränkung:** Unauthentifizierter Traffic (SYN-Floods, rohe HTTP-Anfragen ohne Token) erreicht weiterhin den Server. Der Server muss diese Last selbst tragen.

**QubicShield Node** sitzt als Reverse Proxy vor dem Server und filtert auf Netzwerk-Ebene — er baut auf diesem Protokoll als Kern auf und löst genau diese verbleibende Schwäche.

```
Internet
   │
QubicShield Node (Reverse Proxy)
  ├── Kein Token → blockieren oder 402 Payment Required
  ├── Ungültige Signatur → 401
  ├── Angriffsmuster → Forfeit() on-chain
  └── Legitimer Traffic → weiterleiten
   │
Web-Server  (QubicShield Middleware, optionale zweite Prüfebene)
   │
Geschützte API / Ressource
```

| | QubicShield (dieser PoC) | QubicShield Node |
|---|---|---|
| Ebene | Anwendungsschicht (L7) | Netzwerk + Anwendung (L3–L7) |
| Position | Im Web-Server | Vor dem Web-Server |
| Schützt gegen | Missbrauch authentifizierter Sessions | Alle eingehenden Verbindungen |
| Unauthentifizierter Traffic | Erreicht den Server | Wird davor blockiert |
| Standalone nutzbar | **Ja** | Nein — braucht das Protokoll als Kern |
| Status | Funktionierender Proof of Concept | Konzept / Vision |

Der Node macht QubicShield nicht obsolet. Er erweitert das Protokoll auf eine tiefere Ebene. Ohne das funktionierende Deposit/Signing-Protokoll gibt es keinen Node.

**Entwicklungsreihenfolge:**
1. QubicShield PoC → beweist, dass das Protokoll funktioniert
2. Testnet-Deploy → validiert gegen echten Smart Contract
3. QubicShield Node → baut auf dem validierten Protokoll auf, erweitert auf Infrastruktur-Ebene

→ Vollständige Details: [docs/gedanken/qubicshield-vs-node.md](docs/gedanken/qubicshield-vs-node.md)

---

## Aktueller Stand

Dies ist ein funktionsfähiger Proof of Concept:

- **Smart Contract** (`QubicShield.h`) — in C++/QPI geschrieben, bereit für Testnet-Deploy
- **Web-Proxy** (`src/server.ts`) — Node.js/Express, Mock- und Real-SC-Modus
- **TypeScript SDK** (`src/scClient.ts`) — Wrapper für `@qubic-lib/qubic-ts-library`
- **Frontend** — API Tester, automatische Simulation, Live-Dashboard
- **Tests** — 56 Tests, alle grün
- **Dokumentation** — interaktiver zweisprachiger Guide (DE/EN) unter `index.html`

Was im Mock-Modus funktioniert, funktioniert. Der nächste Schritt ist der Testnet-Deploy und End-to-End-Validierung gegen einen echten Smart Contract.

### Bekannte Einschränkungen (ehrliche Offenlegung)

- **Epochenwechsel** — wöchentlicher Netzwerk-Neustart (~45 Min. Ausfall) übersteigt das aktuelle Retry-Fenster. Das Qubic-Team arbeitet daran.
- **On-Chain Forfeit** wird bei erkanntem Angriff noch nicht aufgerufen — Testnet-Blocker, muss implementiert werden.
- **Leere Ticks** — Transaktionen können stillschweigend verworfen werden und brauchen clientseitige Retry-Logik.

Vollständige Liste in [README_de.md — Bekannte technische Probleme](README_de.md).

---

## Call to Action

Dieses Projekt sucht:

**Qubic-Community-Entwickler**
- PoC testen, `npm run dev` ausprobieren, Issues öffnen, Pull Requests senden
- Hilfe beim Testnet-Deploy

**Qubic Foundation**
- Feedback zum Konzept
- Grant-Antrag besprechen — ist das die Art Infrastruktur, die das Ökosystem braucht?

**Alle, die einen Web-Dienst betreiben**
- Würdet ihr das nutzen? Was braucht ihr?
- Welche Kautionshöhe würde für euren Anwendungsfall Sinn ergeben?

**Discord:** #developers im Qubic-Discord  
**GitHub:** Issue öffnen oder eine Diskussion starten

---

## Quellen

- [Qubic QPI-Dokumentation](https://docs.qubic.org/developers/qpi/)
- [Hashcash — Adam Back, 1997](http://www.hashcash.org/papers/hashcash.pdf)
- [Dwork & Naor 1993 — Pricing via Processing](https://gwern.net/doc/bitcoin/1993-dwork.pdf)
- [Lightning Network HTLCs](https://lightning.network/lightning-network-paper.pdf)
- [Proof of Work as DDoS mitigation — HTTPWG](https://github.com/httpwg/http-core/issues/935)
