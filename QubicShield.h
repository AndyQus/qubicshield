// =============================================================================
// QubicShield.h — Qubic Smart Contract
// DDoS protection via economic deposit incentives
//
// Version: 0.1.0 (Proof of Concept)
// =============================================================================
//
// HOW IT WORKS (the big picture):
//
//   Step 1 — User calls Deposit():
//     The user sends QUBIC along with the call. The SC stores the deposit,
//     generates a unique session token (via K12 hash) and returns it.
//     The web proxy uses this token to grant access.
//
//   Step 2 — Web proxy calls ValidateSession():
//     Before every request the proxy asks the SC: "Is this token still valid?"
//     Only sessions with status HELD and not expired return valid=true.
//
//   Step 3a — Clean exit: user calls Refund():
//     The SC verifies the caller is the original depositor, then transfers
//     the QUBIC back using qpi.transfer(). Clean users pay nothing.
//
//   Step 3b — Attack detected: operator calls Forfeit():
//     The proxy detected an attack pattern and calls Forfeit(). The QUBIC
//     stays in the SC until BEGIN_EPOCH runs the 50/50 distribution:
//     50% is burned (permanent supply reduction), 50% goes to the operator
//     as compensation for the attack. Attackers lose their entire deposit.
//
// WHY THIS ONLY WORKS ON QUBIC:
//   On Ethereum, every qpi.transfer() costs gas. If the deposit is 0.001 EUR
//   but the gas for refunding costs 0.05 EUR, the model breaks. Qubic has
//   zero transaction fees — refunds are always economically viable.
//
// KEY QPI CONSTRAINTS (this file is linted by the VS Code extension):
//   - No #include: all types come from QPI built-ins
//   - No raw / or %: use div() and mod() instead
//   - No strings: identities use the 'id' type (60-byte hash)
//   - No dynamic memory (new/delete/pointers): fixed Array<T, N>
//   - No bool/int/char: use bit, sint64, uint32, uint8 etc.
//   - Time is tick-based via qpi.tick(), not UTC clocks
//
// =============================================================================


// -----------------------------------------------------------------------------
// CONSTANTS
// How many deposit slots the contract can hold simultaneously.
// Increasing this costs more contract state memory on every Qubic node.
// 512 is a reasonable PoC value — raise for production.
// -----------------------------------------------------------------------------
#define MAX_DEPOSITS    512

// How long a session stays valid after the deposit (in ticks).
// Qubic produces approximately 2 ticks per second.
// 3 600 ticks ≈ 30 minutes — adjust based on your use case.
#define SESSION_DURATION_TICKS  3600

// Minimum deposit amount (in QUBIC units, 1 QUBIC = 1_000_000_000 units).
// Below this threshold a deposit is rejected. Keeps dust attacks uneconomical.
#define MIN_DEPOSIT_AMOUNT  10


// -----------------------------------------------------------------------------
// DepositEntry — one row in the deposit table
//
// In a normal database you would use a struct with strings and dynamic fields.
// In QPI everything must be a fixed-size value type:
//   - Wallet addresses and tokens are 'id' (a 60-byte hash type built into QPI)
//   - Amounts are sint64 (signed 64-bit integer, the native QUBIC unit type)
//   - Status is uint8 (1 byte: 0=empty, 1=held, 2=refunded, 3=forfeited)
//   - Tick values are uint32 (Qubic tick counter, fits in 32 bits for decades)
// -----------------------------------------------------------------------------
struct DepositEntry
{
    id       owner;           // wallet address of the depositor
    id       token;           // session token issued to the user (K12 hash)
    sint64   amount;          // amount held in QUBIC units
    uint32   createdTick;     // qpi.tick() at the moment of deposit
    uint32   expiresAtTick;   // createdTick + SESSION_DURATION_TICKS
    uint8    status;          // 0=empty  1=held  2=refunded  3=forfeited
    uint32   requestCount;    // how many requests this session has made
};

// Status constants — easier to read than raw numbers in the code
#define STATUS_EMPTY      0
#define STATUS_HELD       1
#define STATUS_REFUNDED   2
#define STATUS_FORFEITED  3


// =============================================================================
// The contract struct — everything inside here IS the smart contract.
// State variables survive between calls (stored on every Qubic node).
// Procedures and functions are the callable entry points.
// =============================================================================

struct QubicShield
{
    // -------------------------------------------------------------------------
    // STATE VARIABLES
    // These are stored permanently on the blockchain.
    // Think of them as the "database" of the contract.
    // -------------------------------------------------------------------------

    // The deposit table — fixed array of MAX_DEPOSITS slots.
    // Slots with status==STATUS_EMPTY are free to use.
    // IMPORTANT: 'Array' is a QPI built-in, not std::array.
    Array<DepositEntry, MAX_DEPOSITS> deposits;

    // The wallet address that is allowed to call Forfeit() and WithdrawForfeited().
    // Set once in BEGIN_EPOCH during contract initialization.
    id operator_;

    // Aggregate counters — updated on every deposit/refund/forfeit.
    // These power the GetStats() function without needing to scan all deposits.
    uint32  totalDepositsEver;   // all deposits created since contract deployed
    uint32  activeCount;         // currently HELD sessions
    sint64  totalHeld;           // QUBIC currently locked in the contract
    sint64  totalRefunded;       // total QUBIC ever returned to users
    sint64  totalForfeited;       // cumulative total QUBIC ever forfeited (all-time)
    sint64  distributedForfeited; // cumulative total QUBIC already distributed from forfeits
                                  // pending = totalForfeited - distributedForfeited
    sint64  totalBurned;          // cumulative QUBIC permanently removed from supply (50% of forfeits)
    sint64  totalToVictim;        // cumulative QUBIC transferred to attacked operators  (50% of forfeits)


    // =========================================================================
    // INPUT / OUTPUT STRUCTS
    //
    // Every PUBLIC_PROCEDURE and PUBLIC_FUNCTION needs exactly one _input and
    // one _output struct. These define what data goes in and what comes back.
    // QPI does not support method overloading or optional parameters.
    // =========================================================================

    // -------------------------------------------------------------------------
    // Deposit — user pays QUBIC to receive a session token
    // -------------------------------------------------------------------------
    struct Deposit_input
    {
        // The amount the user wants to deposit (in QUBIC units).
        // NOTE for PoC: In a production contract this would be verified
        // against the actual QU sent with the transaction. Here we trust
        // the caller — acceptable for a testnet PoC.
        sint64 amount;
    };

    struct Deposit_output
    {
        id      token;           // the session token — pass this to the proxy
        uint32  sessionIndex;    // index in the deposits array (for later calls)
        uint32  expiresAtTick;   // when this session expires
        uint8   success;         // 1 = deposit created,  0 = rejected
        uint8   errorCode;       // 0=ok  1=amount too low  2=no free slot
    };

    // -------------------------------------------------------------------------
    // Refund — user ends their session and gets QUBIC back
    // -------------------------------------------------------------------------
    struct Refund_input
    {
        uint32  sessionIndex;    // the index returned by Deposit
        id      token;           // must match the stored token (proof of ownership)
    };

    struct Refund_output
    {
        uint8   success;         // 1 = refunded,  0 = failed
        uint8   errorCode;       // 0=ok  1=not found  2=wrong caller
                                 //       3=already processed  4=attack detected
        sint64  refundedAmount;  // amount returned (0 if failed)
    };

    // -------------------------------------------------------------------------
    // Forfeit — operator marks a session as an attacker; deposit is kept
    // -------------------------------------------------------------------------
    struct Forfeit_input
    {
        uint32  sessionIndex;    // which session to forfeit
    };

    struct Forfeit_output
    {
        uint8   success;         // 1 = forfeited,  0 = failed
        uint8   errorCode;       // 0=ok  1=not found  2=not operator
                                 //       3=already processed
    };

    // -------------------------------------------------------------------------
    // SetOperator — transfer operator role to a new wallet
    // -------------------------------------------------------------------------
    struct SetOperator_input
    {
        // The new operator wallet address.
        // Must not be zero — a zero address would lock the contract permanently.
        id newOperator;
    };

    struct SetOperator_output
    {
        uint8   success;     // 1 = operator updated,  0 = failed
        uint8   errorCode;   // 0=ok  1=not current operator  2=zero address rejected
        id      oldOperator; // the previous operator (for audit trail)
    };

    // -------------------------------------------------------------------------
    // WithdrawForfeited — operator withdraws accumulated forfeited QUBIC
    // -------------------------------------------------------------------------
    struct WithdrawForfeited_input
    {
        // How much QUBIC to withdraw (in QUBIC units).
        // Must be <= totalForfeited and <= qpi.contractBalance().
        sint64 amount;
    };

    struct WithdrawForfeited_output
    {
        uint8   success;         // 1 = withdrawn,  0 = failed
        uint8   errorCode;       // 0=ok  1=not operator  2=amount too high
                                 //       3=insufficient contract balance
        sint64  withdrawnAmount; // actual amount transferred (0 if failed)
    };

    // -------------------------------------------------------------------------
    // ValidateSession — proxy checks if a token is still valid
    // -------------------------------------------------------------------------
    struct ValidateSession_input
    {
        id  token;               // the token to look up
    };

    struct ValidateSession_output
    {
        uint8   valid;           // 1 = valid and active,  0 = invalid
        uint32  sessionIndex;    // which slot (0 if invalid)
        uint32  expiresAtTick;   // when it expires (0 if invalid)
        id      owner;           // wallet that created this session
        uint32  requestCount;    // requests made so far in this session
    };

    // -------------------------------------------------------------------------
    // GetStats — read aggregate statistics (no input needed)
    // -------------------------------------------------------------------------
    struct GetStats_input  {};   // empty — no parameters needed

    struct GetStats_output
    {
        uint32  totalDepositsEver;
        uint32  activeCount;
        sint64  totalHeld;
        sint64  totalRefunded;
        sint64  totalForfeited;
        sint64  totalBurned;          // 50% of distributed forfeits — permanently destroyed
        sint64  totalToVictim;        // 50% of distributed forfeits — paid to attacked operators
        sint64  pendingDistribution;  // forfeited but not yet distributed (= next epoch's pool)
    };


    // =========================================================================
    // EPOCH HOOK — runs once at the start of every Qubic epoch (~weekly)
    //
    // Use this for one-time initialization and periodic housekeeping.
    // On first deploy, operator_ will be a zero-id — we set it to the
    // entity that deployed the contract (qpi.invocator() of the epoch call).
    // =========================================================================
    BEGIN_EPOCH
    {
        // -----------------------------------------------------------------------
        // PART 1 — First-time initialization (runs only on first deploy)
        // -----------------------------------------------------------------------
        id zeroId;   // default-constructed id is all zeros in QPI
        if (operator_ == zeroId)
        {
            // qpi.originator() returns the wallet that triggered this epoch.
            // We store it as the operator who is allowed to call Forfeit().
            operator_ = qpi.originator();
        }

        // -----------------------------------------------------------------------
        // PART 2 — Forfeit revenue distribution (runs every epoch)
        //
        // All QUBIC forfeited since the last distribution is split 50/50:
        //   50% → burned permanently    (attacker tokens are destroyed; deflation)
        //   50% → operator              (compensation for the attacked service)
        //    0% → shareholders          (by design: no rent-seeking from DDoS victims)
        //
        // Design rationale:
        //   The goal of QubicShield is to make DDoS economically irrational.
        //   Burning half punishes the attacker. Paying the victim compensates the
        //   harm. Shareholders receive nothing — the value flows to the ecosystem
        //   (burn = deflation benefits all holders) and the attacked party directly.
        //
        // We track distributedForfeited to know what is still pending.
        // pending = totalForfeited - distributedForfeited
        // -----------------------------------------------------------------------
        sint64 pending = totalForfeited - distributedForfeited;

        if (pending > 0)
        {
            // Integer division: any single-unit remainder stays in the contract.
            sint64 half = div(pending, 2);

            // Burn 50% — permanently removes tokens from supply
            if (half > 0)
            {
                qpi.burn(half);
                totalBurned = totalBurned + half;
            }

            // 50% to operator — compensation for the attacked service
            if (half > 0)
            {
                qpi.transfer(operator_, half);
                totalToVictim = totalToVictim + half;
            }

            // Record how much we distributed (2 × half to handle odd-unit remainder)
            distributedForfeited = distributedForfeited + half + half;
        }
    }
    END_EPOCH


    // =========================================================================
    // TICK HOOK — runs every tick (≈ 2× per second)
    //
    // We use this for automatic expiry: scan all HELD deposits and forfeit
    // any that have passed their expiresAtTick. This replaces the server-side
    // "auto-forfeit expired sessions" logic from depositManager.ts.
    //
    // NOTE: In production, scanning all 512 slots every tick costs compute.
    // A production contract would use a more efficient expiry queue.
    // For a PoC this is fine.
    // =========================================================================
    BEGIN_TICK
    {
        uint32 currentTick = qpi.tick();

        // Loop through every deposit slot and expire stale sessions.
        // QPI for-loops use sint64 counters — no ranged-for available.
        sint64 i = 0;
        for (i = 0; i < MAX_DEPOSITS; i = i + 1)
        {
            // Only look at active (HELD) sessions
            if (deposits.get(i).status != STATUS_HELD)
            {
                continue;
            }

            // If the current tick has passed the expiry tick, forfeit
            if (currentTick > deposits.get(i).expiresAtTick)
            {
                DepositEntry entry = deposits.get(i);
                entry.status = STATUS_FORFEITED;
                deposits.set(i, entry);

                // Update aggregates
                totalHeld = totalHeld - entry.amount;
                totalForfeited = totalForfeited + entry.amount;
                activeCount = activeCount - 1;
            }
        }
    }
    END_TICK


    // =========================================================================
    // PUBLIC PROCEDURES
    // Procedures CAN modify state and transfer QUBIC.
    // They are called by external wallets or the web proxy.
    // =========================================================================

    // -------------------------------------------------------------------------
    // Deposit — the entry point for users wanting protected access
    //
    // What happens here (mirrors depositManager.createDeposit()):
    //   1. Reject if amount is below the minimum
    //   2. Find a free slot in the deposits array
    //   3. Generate a session token using the K12 hash function
    //   4. Store the deposit and update aggregate counters
    //   5. Return the token and session index to the caller
    //
    // The token is derived from K12(owner + currentTick).
    // This is deterministic but unpredictable from outside because the exact
    // tick value is only known at execution time on the network.
    // -------------------------------------------------------------------------
    PUBLIC_PROCEDURE(Deposit)
    {
        // --- Input validation ------------------------------------------------

        if (input.amount < MIN_DEPOSIT_AMOUNT)
        {
            output.success   = 0;
            output.errorCode = 1;  // amount too low
            return;
        }

        // --- Find a free slot -------------------------------------------------
        // Scan the array for the first entry with status==STATUS_EMPTY.
        // Using sint64 as loop variable because QPI arrays are indexed by sint64.

        sint64 freeSlot = -1;
        sint64 i        = 0;
        for (i = 0; i < MAX_DEPOSITS; i = i + 1)
        {
            if (deposits.get(i).status == STATUS_EMPTY)
            {
                freeSlot = i;
                break;  // found one — stop searching
            }
        }

        if (freeSlot < 0)
        {
            // All 512 slots are occupied — contract is full
            output.success   = 0;
            output.errorCode = 2;  // no free slot
            return;
        }

        // --- Generate the session token ---------------------------------------
        // We hash a struct combining three independent entropy sources:
        //
        //   owner     — wallet-specific:  different wallets → different tokens
        //   tick      — time-specific:    same wallet at different ticks → different tokens
        //   slotIndex — position-specific: same wallet, same tick, different slot → different tokens
        //
        // All three must collide simultaneously for two tokens to match.
        // K12 is Qubic's built-in hash — accepts any fixed-size value.

        struct TokenSeed
        {
            id     owner;
            uint32 tick;
            sint64 slotIndex;
        };

        id caller = qpi.invocator();

        TokenSeed seed;
        seed.owner     = caller;
        seed.tick      = qpi.tick();
        seed.slotIndex = freeSlot;

        id sessionToken = qpi.K12(seed);

        // --- Build and store the deposit entry --------------------------------

        DepositEntry entry;
        entry.owner         = caller;
        entry.token         = sessionToken;
        entry.amount        = input.amount;
        entry.createdTick   = qpi.tick();
        entry.expiresAtTick = qpi.tick() + SESSION_DURATION_TICKS;
        entry.status        = STATUS_HELD;
        entry.requestCount  = 0;

        deposits.set(freeSlot, entry);

        // --- Update aggregate counters ----------------------------------------

        totalDepositsEver = totalDepositsEver + 1;
        activeCount       = activeCount + 1;
        totalHeld         = totalHeld + input.amount;

        // --- Return results to caller -----------------------------------------

        output.token          = sessionToken;
        output.sessionIndex   = freeSlot;  // cast is safe: freeSlot < MAX_DEPOSITS
        output.expiresAtTick  = entry.expiresAtTick;
        output.success        = 1;
        output.errorCode      = 0;
    }


    // -------------------------------------------------------------------------
    // Refund — user cleanly ends their session and receives QUBIC back
    //
    // What happens here (mirrors depositManager.refundDeposit()):
    //   1. Look up the session at sessionIndex
    //   2. Verify the token matches (proves the caller owns this session)
    //   3. Verify the session is still HELD (not already processed)
    //   4. Transfer the QUBIC back to the owner
    //   5. Update status and aggregate counters
    //
    // Security: both sessionIndex AND token must match. This prevents an
    // attacker from refunding someone else's deposit by guessing the index.
    // -------------------------------------------------------------------------
    PUBLIC_PROCEDURE(Refund)
    {
        // --- Bounds check on sessionIndex ------------------------------------

        if (input.sessionIndex >= MAX_DEPOSITS)
        {
            output.success   = 0;
            output.errorCode = 1;  // not found
            return;
        }

        DepositEntry entry = deposits.get(input.sessionIndex);

        // --- Verify session is active ----------------------------------------

        if (entry.status != STATUS_HELD)
        {
            output.success   = 0;
            output.errorCode = 3;  // already processed (refunded or forfeited)
            return;
        }

        // --- Verify token matches (proves caller owns this session) ----------
        // In QPI, 'id' values can be compared with ==.

        if (entry.token != input.token)
        {
            output.success   = 0;
            output.errorCode = 2;  // wrong token — not the session owner
            return;
        }

        // --- Transfer QUBIC back to the depositor ----------------------------
        // qpi.transfer(destination, amount) sends QUBIC from the contract
        // to the destination wallet. This is the key Qubic operation that
        // makes the whole refund model work at zero cost.

        // Save the amount BEFORE zeroing it — counters must use the real value
        sint64 refundedAmount = entry.amount;

        qpi.transfer(entry.owner, refundedAmount);

        // --- Update state ----------------------------------------------------

        entry.status = STATUS_REFUNDED;
        entry.amount = 0;   // clear after transfer — entry now reflects zero held
        deposits.set(input.sessionIndex, entry);

        totalHeld     = totalHeld - refundedAmount;
        totalRefunded = totalRefunded + refundedAmount;
        activeCount   = activeCount - 1;

        // --- Return results --------------------------------------------------

        output.success        = 1;
        output.errorCode      = 0;
        output.refundedAmount = refundedAmount;
    }


    // -------------------------------------------------------------------------
    // Forfeit — operator marks a session as an attacker; QUBIC is kept
    //
    // What happens here (mirrors depositManager.forfeitDeposit()):
    //   1. Verify the caller is the operator
    //   2. Look up and validate the session
    //   3. Change status to FORFEITED — no transfer back
    //   4. Update aggregate counters
    //
    // The forfeited QUBIC stays in the contract. In a future version,
    // a WithdrawForfeited() procedure would let the operator collect it.
    // -------------------------------------------------------------------------
    PUBLIC_PROCEDURE(Forfeit)
    {
        // --- Only the operator can call this ---------------------------------
        // qpi.invocator() returns the wallet that sent this transaction.
        // If it is not the stored operator, reject immediately.

        if (qpi.invocator() != operator_)
        {
            output.success   = 0;
            output.errorCode = 2;  // not operator
            return;
        }

        // --- Bounds and status check -----------------------------------------

        if (input.sessionIndex >= MAX_DEPOSITS)
        {
            output.success   = 0;
            output.errorCode = 1;  // not found
            return;
        }

        DepositEntry entry = deposits.get(input.sessionIndex);

        if (entry.status != STATUS_HELD)
        {
            output.success   = 0;
            output.errorCode = 3;  // already processed
            return;
        }

        // --- Forfeit the deposit — no refund ---------------------------------

        sint64 forfeitedAmount = entry.amount;

        entry.status = STATUS_FORFEITED;
        entry.amount = 0;
        deposits.set(input.sessionIndex, entry);

        totalHeld      = totalHeld - forfeitedAmount;
        totalForfeited = totalForfeited + forfeitedAmount;
        activeCount    = activeCount - 1;

        output.success   = 1;
        output.errorCode = 0;
    }


    // -------------------------------------------------------------------------
    // WithdrawForfeited — operator collects forfeited QUBIC before epoch distribution
    //
    // IMPORTANT — accounting model:
    //   totalForfeited      = all QUBIC ever forfeited (cumulative, never decremented)
    //   distributedForfeited = all QUBIC already paid out (via BEGIN_EPOCH or this call)
    //   pending             = totalForfeited - distributedForfeited
    //
    // This procedure lets the operator withdraw from the pending pool early —
    // before the next BEGIN_EPOCH runs the automatic 50/50 split.
    //
    // We MUST increment distributedForfeited (not decrement totalForfeited) so that
    // BEGIN_EPOCH does not double-count this withdrawal in the next epoch.
    //
    // Why allow early withdrawal at all?
    //   The operator (attacked service) may need compensation immediately after an
    //   attack, not just once a week. This is an emergency escape hatch.
    //   The 50/50 split still applies: caller receives 50%, the other 50% is burned.
    //
    // What happens here:
    //   1. Verify the caller is the operator
    //   2. Verify the requested amount does not exceed the pending (undistributed) pool
    //   3. Verify the contract actually holds enough QUBIC (safety check)
    //   4. Apply 50/50 split: burn half, transfer half to operator
    //   5. Mark as distributed so BEGIN_EPOCH skips this amount
    // -------------------------------------------------------------------------
    PUBLIC_PROCEDURE(WithdrawForfeited)
    {
        // --- Only the operator may withdraw -----------------------------------

        if (qpi.invocator() != operator_)
        {
            output.success        = 0;
            output.errorCode      = 1;  // not operator
            output.withdrawnAmount = 0;
            return;
        }

        // --- Amount must be positive and within the *pending* pool -----------
        // pending = totalForfeited - distributedForfeited
        // We must not allow withdrawing already-distributed amounts.

        sint64 pending = totalForfeited - distributedForfeited;

        if (input.amount <= 0 || input.amount > pending)
        {
            output.success        = 0;
            output.errorCode      = 2;  // amount exceeds pending pool (or zero)
            output.withdrawnAmount = 0;
            return;
        }

        // --- Safety: contract must actually hold enough QUBIC ----------------

        if (input.amount > qpi.contractBalance())
        {
            output.success        = 0;
            output.errorCode      = 3;  // insufficient contract balance
            output.withdrawnAmount = 0;
            return;
        }

        // --- Apply 50/50 split: burn half, pay half to operator --------------
        // Integer division: odd-unit remainder stays in the contract.

        sint64 half = div(input.amount, 2);

        if (half > 0)
        {
            qpi.burn(half);
            totalBurned = totalBurned + half;
        }

        if (half > 0)
        {
            qpi.transfer(operator_, half);
            totalToVictim = totalToVictim + half;
        }

        // --- Mark as distributed so BEGIN_EPOCH skips this amount ------------
        // We advance distributedForfeited by the full input.amount.
        // Any odd-unit remainder (input.amount - half - half) stays in contract
        // as reserve and will be included in the next epoch's pending calculation.

        distributedForfeited = distributedForfeited + half + half;

        output.success         = 1;
        output.errorCode       = 0;
        output.withdrawnAmount = half;  // amount actually transferred to operator
    }


    // -------------------------------------------------------------------------
    // SetOperator — transfer the operator role to a new wallet
    //
    // What happens here:
    //   1. Verify the caller is the current operator (only they may transfer)
    //   2. Reject zero address — a zero operator_ would lock Forfeit() forever
    //   3. Save the old operator for the audit trail in the output
    //   4. Update operator_ to the new address
    //
    // SECURITY NOTE — why no two-step confirmation for PoC?
    //   Production contracts often use a two-step "propose + accept" pattern:
    //     Step 1: current operator calls ProposeOperator(newAddress)
    //     Step 2: new address calls AcceptOperator() to confirm ownership
    //   This prevents accidentally transferring to a wrong or inaccessible wallet.
    //   For this PoC we use a single-step transfer. The operator must take care
    //   to verify the new address before calling SetOperator.
    // -------------------------------------------------------------------------
    PUBLIC_PROCEDURE(SetOperator)
    {
        // --- Only the current operator may transfer the role ------------------

        if (qpi.invocator() != operator_)
        {
            output.success   = 0;
            output.errorCode = 1;  // not current operator
            return;
        }

        // --- Reject zero address — would permanently disable Forfeit() -------
        // A default-constructed id in QPI is all zeros.
        // Transferring to zero would make no one able to call Forfeit() ever again.

        id zeroId;
        if (input.newOperator == zeroId)
        {
            output.success   = 0;
            output.errorCode = 2;  // zero address rejected
            return;
        }

        // --- Transfer the role -----------------------------------------------

        output.oldOperator = operator_;   // return previous operator for audit
        operator_          = input.newOperator;

        output.success   = 1;
        output.errorCode = 0;
    }


    // =========================================================================
    // PUBLIC FUNCTIONS
    // Functions can only READ state — they cannot modify it or transfer QUBIC.
    // They are cheap to call and safe to expose publicly.
    // =========================================================================

    // -------------------------------------------------------------------------
    // ValidateSession — proxy checks if a token grants access
    //
    // This is called by the web proxy on every incoming request to verify
    // that the user's token is legitimate and not expired.
    //
    // What happens here (mirrors depositManager.validateToken()):
    //   1. Scan all HELD sessions for a matching token
    //   2. If found: check it has not expired (tick-based)
    //   3. Return valid=1 with session details, or valid=0
    //
    // Why scan? We cannot use a hash map in QPI (no dynamic data structures).
    // With MAX_DEPOSITS=512 this scan costs O(512) — fast enough for a PoC.
    // -------------------------------------------------------------------------
    PUBLIC_FUNCTION(ValidateSession)
    {
        uint32 currentTick = qpi.tick();

        sint64 i = 0;
        for (i = 0; i < MAX_DEPOSITS; i = i + 1)
        {
            DepositEntry entry = deposits.get(i);

            // Skip non-active slots immediately
            if (entry.status != STATUS_HELD)
            {
                continue;
            }

            // Check if the token matches this slot
            if (entry.token != input.token)
            {
                continue;
            }

            // Token found — check expiry
            if (currentTick > entry.expiresAtTick)
            {
                // Expired: report as invalid (the tick hook will clean it up)
                output.valid = 0;
                return;
            }

            // Valid session — fill in the details for the proxy
            output.valid         = 1;
            output.sessionIndex  = i;
            output.expiresAtTick = entry.expiresAtTick;
            output.owner         = entry.owner;
            output.requestCount  = entry.requestCount;
            return;
        }

        // Token not found in any active slot
        output.valid = 0;
    }


    // -------------------------------------------------------------------------
    // GetStats — read-only aggregate counters
    //
    // Powers the admin dashboard. No scanning needed — counters are kept
    // up-to-date by every Deposit/Refund/Forfeit call.
    // -------------------------------------------------------------------------
    PUBLIC_FUNCTION(GetStats)
    {
        output.totalDepositsEver    = totalDepositsEver;
        output.activeCount          = activeCount;
        output.totalHeld            = totalHeld;
        output.totalRefunded        = totalRefunded;
        output.totalForfeited       = totalForfeited;
        output.totalBurned          = totalBurned;
        output.totalToVictim        = totalToVictim;
        output.pendingDistribution  = totalForfeited - distributedForfeited;
    }


    // =========================================================================
    // REGISTRATION
    // Every PUBLIC_PROCEDURE and PUBLIC_FUNCTION MUST be registered here.
    // The index (1, 2, 3, …) is what external callers use to address the
    // entry point. Indices are fixed — never reorder them after deployment.
    // =========================================================================
    REGISTER_USER_FUNCTIONS_AND_PROCEDURES
    {
        // Procedures (can modify state)
        REGISTER_USER_PROCEDURE(Deposit,            1);
        REGISTER_USER_PROCEDURE(Refund,             2);
        REGISTER_USER_PROCEDURE(Forfeit,            3);
        REGISTER_USER_PROCEDURE(WithdrawForfeited,  6);
        REGISTER_USER_PROCEDURE(SetOperator,        7);

        // Functions (read-only)
        REGISTER_USER_FUNCTION(ValidateSession, 4);
        REGISTER_USER_FUNCTION(GetStats,        5);
    }
};
