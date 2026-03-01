

# Tamper-Proof Data Protection for 355 Neon Tables

## The Problem
With Ceramic removed, the 15M+ records across 355 tables need protection against scrubbing, tampering, and unauthorized modification. SHA-256 hashing per-row is already in place, but individual hashes can be recomputed if someone gains DB access -- they could change data AND update the hash to match.

## The Solution: Append-Only Merkle Audit Ledger

A **Merkle chain** stored in an immutable audit table. Each audit entry includes the hash of the previous entry, creating a tamper-evident chain where altering any historical record breaks every subsequent link. This is the same principle Bitcoin uses, but without needing a blockchain network.

### How It Works

```text
Record A hash: abc123
    |
Audit Entry 1: hash(abc123 + "genesis") = def456
    |
Record B hash: ghi789
    |
Audit Entry 2: hash(ghi789 + def456) = jkl012
    |
Record C hash: mno345
    |
Audit Entry 3: hash(mno345 + jkl012) = pqr678
```

If someone scrubs Record B and recomputes its SHA-256, Audit Entry 2 still contains the ORIGINAL hash chained to Entry 1. The chain breaks -- tampering is provably detected.

### Architecture

**1. New Supabase table: `evidence_merkle_ledger`**
- `id` (uuid, PK)
- `sequence_number` (bigint, auto-increment) -- monotonic ordering
- `source_table` (text) -- which Neon table
- `source_id` (text) -- row identifier
- `record_hash` (text) -- the SHA-256 of the source row
- `previous_chain_hash` (text) -- hash of the previous ledger entry
- `chain_hash` (text) -- hash(record_hash + previous_chain_hash)
- `anchored_at` (timestamptz) -- when this entry was chained
- `batch_id` (text) -- group entries by processing batch

RLS: append-only (INSERT for investigators, SELECT for investigators, NO update/delete for anyone).

**2. New edge function: `merkle-anchor`**
- Reads unhashed records from Neon (via existing evidence-fingerprint infrastructure)
- For each record's SHA-256 hash, appends a chained entry to the ledger
- Returns chain verification status

**3. Periodic chain verification**
- Walk the ledger, recompute each `chain_hash` from `record_hash + previous_chain_hash`
- Any break = tampering detected, with exact location identified

**4. Enhanced UI: upgrade ChainOfCustodyPanel**
- Add "Anchor to Merkle Chain" button alongside existing hash operations
- Show chain length, last anchor time, verification status
- Add "Verify Chain Integrity" button that walks the full chain

### Why This Beats Ceramic (For This Use Case)

| Feature | Ceramic | Merkle Ledger |
|---------|---------|---------------|
| Setup complexity | External network, DID keys, SDK | Single DB table + edge function |
| Speed | Slow (network consensus) | Fast (direct DB writes) |
| Cost | Network fees | Free (uses existing infra) |
| Legal admissibility | Novel, untested | Hash chains accepted in federal court |
| Offline resilience | Needs network | Works with just your DB |
| Tampering detection | Yes | Yes -- chain breaks are provable |
| 355-table scale | Impractical | Handles millions of entries |

### Implementation Steps

1. Create `evidence_merkle_ledger` table in Lovable Cloud with strict append-only RLS
2. Build `merkle-anchor` edge function that chains SHA-256 hashes from Neon into the ledger
3. Add chain verification logic to the edge function
4. Update `ChainOfCustodyPanel` with Merkle chain controls (anchor, verify, stats)
5. Add periodic auto-anchoring option (runs on scan intervals)

### Technical Details

- The ledger lives in Lovable Cloud (not Neon), creating a **separation of concerns** -- even if Neon is compromised, the Merkle chain in Lovable Cloud preserves the original hash sequence
- Append-only RLS means no one (not even admins) can UPDATE or DELETE ledger entries via the API
- Chain verification is O(n) but can be batched -- verify last 1000 entries in seconds
- Each batch anchor processes up to 500 records per invocation to stay within edge function limits

