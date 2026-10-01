# Key Transparency Scale Verification

## Summary
This verification resolves the ambiguity in Server Specification v2.0 regarding the scale and implementation requirements for Key Transparency. While the spec schema (§7.10) uses RFC 6962 terminology (`tree_size`, `root_hash`), it omits proof endpoints, signature schemes, key management, and consistency proof definitions. We recommend **Interpretation B (RFC 6962-lite)**: implementing an RFC 6962 binary Merkle tree with standard domain separators (`0x00` leaf, `0x01` node) and Ed25519-signed STHs, exposing inclusion proof endpoints for client key verification, but omitting consistency proofs and multi-log gossip protocols. This fulfills the essential E2EE security objective (verifying key-to-user bindings without server trust) with moderate effort (~3 tasks), avoiding the 5–10× complexity of full web-PKI transparency infrastructure.

## Spec Quotations

### §2.1 In Scope — V2
> - Key transparency. Append-only log with inclusion proofs and auditor signatures.

### §5.22 Key Transparency
```
KEY_TRANSPARENCY_ENABLED=true
KEY_TRANSPARENCY_LOG_PATH=/data/kt-log
KEY_TRANSPARENCY_AUDITOR_KEYS=
```

### §7.10 Key Transparency and Ops
```sql
CREATE TABLE key_transparency_log (
    leaf_index      INTEGER PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username_token  TEXT NOT NULL,
    identity_pubkey TEXT NOT NULL,
    added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kt_user ON key_transparency_log(user_id);
CREATE INDEX idx_kt_added ON key_transparency_log(added_at);

CREATE TABLE key_transparency_snapshots (
    id           TEXT PRIMARY KEY,
    tree_size    INTEGER NOT NULL,
    root_hash    BLOB NOT NULL,
    signature    BLOB,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### §8.3 Admin
```
Method — Path — Purpose
POST — /admin/oprf/rotate — Rotate the username OPRF key (catastrophic)
GET — /admin/key-transparency — Read KT log stats
POST — /admin/key-transparency/snapshot — Trigger a signed snapshot
GET — /admin/rooms/:id/hangouts — Read-only list of hangouts (metadata only, no occupancy)
POST — /admin/models/reload — Reload the model manifest
```

### §8.8 Event Catalog
```
Room events (private-room-{room_id}):
...
kt.snapshot
```

### §14.8 Audit Actions
```
14.8 Audit Actions

V1 actions plus:
...
- kt.snapshot
```

### §16.7 Amendment 19
```
16.7 Amendment 19 — Key Transparency — 2026-09-29

Added key_transparency_log, key_transparency_snapshots. Added auditor signature support. Added kt.snapshot event and admin endpoints.
```

## RFC 6962 Quotations

### §2.1 Merkle Hash Trees
```
2.1. Merkle Hash Trees

   Logs use a binary Merkle Hash Tree for efficient auditing.  The
   hashing algorithm is SHA-256 [FIPS.180-4] (note that this is fixed
   for this experiment, but it is anticipated that each log would be
   able to specify a hash algorithm).  The input to the Merkle Tree Hash
   is a list of data entries; these entries will be hashed to form the
   leaves of the Merkle Hash Tree.  The output is a single 32-byte
   Merkle Tree Hash.  Given an ordered list of n inputs, D[n] = {d(0),
   d(1), ..., d(n-1)}, the Merkle Tree Hash (MTH) is thus defined as
   follows:

   The hash of an empty list is the hash of an empty string:

   MTH({}) = SHA-256().

   The hash of a list with one entry (also known as a leaf hash) is:

   MTH({d(0)}) = SHA-256(0x00 || d(0)).

   For n > 1, let k be the largest power of two smaller than n (i.e.,
   k < n <= 2k).  The Merkle Tree Hash of an n-element list D[n] is then
   defined recursively as

   MTH(D[n]) = SHA-256(0x01 || MTH(D[0:k]) || MTH(D[k:n])),

   where || is concatenation and D[k1:k2] denotes the list {d(k1),
   d(k1+1),..., d(k2-1)} of length (k2 - k1).  (Note that the hash
   calculations for leaves and nodes differ.  This domain separation is
   required to give second preimage resistance.)
```

### §2.1.1 Merkle Audit Paths
```
2.1.1. Merkle Audit Paths

   A Merkle audit path for a leaf in a Merkle Hash Tree is the shortest
   list of additional nodes in the Merkle Tree required to compute the
   Merkle Tree Hash for that tree.  Each node in the tree is either a
   leaf node or is computed from the two nodes immediately below it
   (i.e., towards the leaves).  At each step up the tree (towards the
   root), a node from the audit path is combined with the node computed
   so far.  In other words, the audit path consists of the list of
   missing nodes required to compute the nodes leading from a leaf to
   the root of the tree.  If the root computed from the audit path
   matches the true root, then the audit path is proof that the leaf
   exists in the tree.
```

### §2.1.2 Merkle Consistency Proofs
```
2.1.2. Merkle Consistency Proofs

   Merkle consistency proofs prove the append-only property of the tree.
   A Merkle consistency proof for a Merkle Tree Hash MTH(D[n]) and a
   previously advertised hash MTH(D[0:m]) of the first m leaves, m <= n,
   is the list of nodes in the Merkle Tree required to verify that the
   first m inputs D[0:m] are equal in both trees.
```

### §3.5 Signed Tree Head
```
3.5. Signed Tree Head

   Every time a log appends new entries to the tree, the log SHOULD sign
   the corresponding tree hash and tree information (see the
   corresponding Signed Tree Head client message in Section 4.3).  The
   signature for that data is structured as follows:

       digitally-signed struct {
           Version version;
           SignatureType signature_type = tree_hash;
           uint64 timestamp;
           uint64 tree_size;
           opaque sha256_root_hash[32];
       } TreeHeadSignature;

   "version" is the version of the protocol to which the
   TreeHeadSignature conforms.  This version is v1.

   "timestamp" is the current time.  The timestamp MUST be at least as
   recent as the most recent SCT timestamp in the tree.  Each subsequent
   timestamp MUST be more recent than the timestamp of the previous
   update.

   "tree_size" equals the number of entries in the new tree.

   "sha256_root_hash" is the root of the Merkle Hash Tree.
```

### §4.5 Retrieve Merkle Audit Proof from Log by Leaf Hash
```
4.5. Retrieve Merkle Audit Proof from Log by Leaf Hash

   GET https://<log server>/ct/v1/get-proof-by-hash

   Inputs:

      hash:  A base64-encoded v1 leaf hash.

      tree_size:  The tree_size of the tree on which to base the proof,
         in decimal.

   Outputs:

      leaf_index:  The 0-based index of the end entity corresponding to
         the "hash" parameter.

      audit_path:  An array of base64-encoded Merkle Tree nodes proving
         the inclusion of the chosen certificate.
```

## RFC 6962 Feature Comparison

| RFC 6962 feature | Defined in spec? | Where? / Substitution & Missing Details |
|---|---|---|
| Leaf hash with `0x00` prefix | No | Not specified. §7.10 specifies columns but no leaf hashing algorithm or prefix. |
| Internal node hash with `0x01` prefix | No | Not specified. RFC 6962 §2.1 domain separation is not mentioned. |
| Merkle Audit Path (inclusion proof) | Mentioned | §2.1 lists "inclusion proofs", but no endpoint or data structure is defined in §8 or §7. |
| Merkle Consistency Proof | No | Not defined. Spec contains no consistency proof concepts or endpoints. |
| Signed Tree Head (STH) | Implied | §7.10 `key_transparency_snapshots` contains `tree_size`, `root_hash`, and `signature`. |
| STH signature algorithm | No | Not specified. §7.10 has `signature BLOB` with no specified algorithm. |
| STH signing key | No | Not specified. §5.22 lists `KEY_TRANSPARENCY_AUDITOR_KEYS` but no server STH signing key variable. |
| Client-side inclusion proof verification | No | Not specified in server spec (deferring to client spec, but unmentioned in §6). |
| Client-side consistency proof verification | No | Not defined in server spec. |
| Gossip / monitoring protocol | No | Not specified. §2.1 mentions "auditor signatures", but no gossip protocol exists. |
| Log entry submission endpoint | No | Internal server workflow. Entries append automatically on user register/key update. |
| Log entry retrieval endpoint | No | No public `GET /key-transparency/entries` endpoint defined in §8. |
| `GET /proof/inclusion/:leaf_index` | No | Omitted from §8 API surface. |
| `GET /proof/consistency` | No | Omitted from §8 API surface. |
| `GET /sth` | Partial | §8.3 defines `POST /admin/key-transparency/snapshot`, but no public STH endpoint. |

## Implementation Cost Analysis

### Interpretation A — Full RFC 6962
Full RFC 6962 implementation requires a complete CT log ecosystem suitable for public web-PKI auditing:
- RFC 6962 binary Merkle tree engine with SHA-256 and `0x00`/`0x01` domain separators.
- Inclusion proof generation (`GET /key-transparency/proof/inclusion/:leaf_index`).
- Consistency proof generation (`GET /key-transparency/proof/consistency?first=N&second=M`).
- Signed Tree Head endpoint (`GET /key-transparency/sth`) and snapshot trigger.
- Dedicated STH signing key management (generation, Unix file permissions, backup integration).
- Full auditor signature verification pipeline (`KEY_TRANSPARENCY_AUDITOR_KEYS`).
- Log entry retrieval API (`GET /key-transparency/entries`).
- Client verification guidelines and gossip protocol documentation.
- **Estimated Effort:** 7–9 dedicated engineering tasks (~3–4 weeks).

### Interpretation B — RFC 6962-lite
RFC 6962-lite implements the Merkle tree and inclusion proofs required for identity key verification, while dropping public web-PKI monitoring overhead:
- In-memory/SQLite-backed RFC 6962 Merkle tree structure using SHA-256 with `0x00` and `0x01` prefixes.
- Automatic leaf insertion on registration or key update (`key_transparency_log`).
- Public inclusion proof endpoint (`GET /api/v1/key-transparency/proof/:leaf_index` or by `user_id`).
- Public STH endpoint (`GET /api/v1/key-transparency/sth`) returning Ed25519-signed snapshots.
- Admin trigger endpoint (`POST /api/v1/admin/key-transparency/snapshot`) publishing `kt.snapshot` event.
- STH signing key derived deterministically from the server root secret or stored at `KEY_TRANSPARENCY_SIGNING_KEY_PATH`.
- No consistency proof endpoint and no gossip protocol.
- **Estimated Effort:** 3 dedicated engineering tasks (~1 week).

### Interpretation C — Simplified Log
A minimal append-only linear log without Merkle tree binary structures:
- `leaf_index` is a monotonic counter in SQLite.
- `root_hash` is computed as `SHA-256(leaf_0 || leaf_1 || ... || leaf_N)`.
- Snapshots record `(tree_size, root_hash)` signed with Ed25519.
- No inclusion proof algorithm (clients must fetch all entries to recompute the linear hash).
- No consistency proofs.
- **Estimated Effort:** 1 task (~2 days).

## Security Properties

| Property | Interpretation A (Full RFC 6962) | Interpretation B (RFC 6962-lite) | Interpretation C (Simplified Log) |
|---|---|---|---|
| **Detects log equivocation?** | Yes (via consistency proofs & gossip) | Partial (via signed STHs & client STH sharing) | Weak (requires fetching full log history) |
| **Detects retroactive modification?** | Yes (Merkle tree root changes) | Yes (Merkle tree root changes) | Yes (linear hash changes) |
| **Provides inclusion proofs?** | Yes ($O(\log N)$ audit path) | Yes ($O(\log N)$ audit path) | No ($O(N)$ full log download required) |
| **Supports monitoring?** | Yes (full CT auditor standard) | Yes (monitors fetch STHs and entries) | Poor ($O(N)$ bandwidth cost) |

### Discussion against RFC 6962 §1 CT Design Goals
RFC 6962 §1 states that transparency logs must provide publicly auditable, append-only records so that clients can verify inclusion and monitors can detect equivocation. In E2EE messaging, the primary threat is an active server MITM presenting fake identity public keys to communication partners.

To defeat this threat, a client fetching a peer's identity key must receive a cryptographic **inclusion proof** linking that key to a published Signed Tree Head (STH). Interpretation C fails this requirement because verifying a key requires downloading the entire log ($O(N)$ bandwidth). Interpretation B supplies logarithmic ($O(\log N)$) inclusion proofs while avoiding the unnecessary complexity of consistency proofs between arbitrary historical STH pairs.

## Recommendation

We recommend **Interpretation B (RFC 6962-lite)** for project adoption:
1. **Spec Alignment:** The spec's inclusion of `tree_size` and `root_hash` in §7.10 proves that a Merkle tree was intended. Interpretation B honors this schema directly.
2. **E2EE Core Security:** Inclusion proofs are mandatory for client-side key verification. Interpretation B provides $O(\log N)$ inclusion proofs without requiring full log downloads.
3. **Pragmatic Scope:** Full RFC 6962 consistency proofs and gossip protocols address multi-CA web-PKI ecosystems with independent competitive logs. An isolated E2EE messaging server does not require multi-log gossip; signing STHs with an operator key provides strong accountability.

## Proposed Spec Amendments

### Amendment to §7.10 Key Transparency and Ops

Replace §7.10 text with:

```
7.10 Key Transparency and Ops

The server maintains an append-only Key Transparency log using an RFC 6962 Merkle Hash Tree over SHA-256.

Leaf Hash Construction:
  MTH({d(i)}) = SHA-256(0x00 || user_id || 0x00 || username_token || 0x00 || identity_pubkey || 0x00 || added_at)

Internal Node Hash Construction:
  MTH(D[n])   = SHA-256(0x01 || MTH(D[0:k]) || MTH(D[k:n]))

where k is the largest power of two smaller than n.

Snapshots and STH Signatures:
A Signed Tree Head (STH) commits to (version=1, timestamp, tree_size, root_hash). The signature is an Ed25519 signature over:
  signed_bytes = "kt-sth-v1" || I2OSP(timestamp, 8) || I2OSP(tree_size, 8) || root_hash

The STH signing key is stored at KEY_TRANSPARENCY_SIGNING_KEY_PATH (default /data/kt-signing.key) or derived via HKDF-Expand(root_secret, info="kt-signing-key-v1", length=32).

CREATE TABLE key_transparency_log (
    leaf_index      INTEGER PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username_token  TEXT NOT NULL,
    identity_pubkey TEXT NOT NULL,
    added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kt_user ON key_transparency_log(user_id);
CREATE INDEX idx_kt_added ON key_transparency_log(added_at);

CREATE TABLE key_transparency_snapshots (
    id           TEXT PRIMARY KEY,
    tree_size    INTEGER NOT NULL,
    root_hash    BLOB NOT NULL,
    signature    BLOB NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Amendment to §8.3 Admin & Addition of Public Key Transparency Endpoints

Add to §8 API Surface:

```
Public Key Transparency Endpoints:

GET /api/v1/key-transparency/sth
Auth: Optional. Returns latest Signed Tree Head { tree_size, root_hash, signature, created_at }.

GET /api/v1/key-transparency/proof/:leaf_index
Auth: Optional. Returns Merkle audit path for leaf_index: { leaf_index, tree_size, audit_path: ["<base64>", ...] }.

GET /api/v1/key-transparency/proof?user_id=<user_id>
Auth: Optional. Returns latest leaf entry and audit path for the specified user.
```

### Addition to §16 Amendments: Amendment 35

```
16.35 Amendment 35 — Key Transparency Scale and Proof Endpoints — 2026-10-01

Adopted Interpretation B (RFC 6962-lite) for Key Transparency. Specified RFC 6962 SHA-256 Merkle tree hashing with 0x00 leaf and 0x01 internal node domain separators. Defined Ed25519 STH signature structure. Added public endpoints GET /key-transparency/sth and GET /key-transparency/proof for client inclusion proof verification.

Sections affected: §2.1, §5.22, §7.10, §8.1, §8.3, §16.35.
```

## Uncertainties

1. **Client Spec Verification Flow:** The server specification does not dictate whether clients verify inclusion proofs synchronously upon fetching public keys or asynchronously in the background. This choice belongs to the Client Specification v1.0.
2. **Auditor Key Federation:** Environment variable `KEY_TRANSPARENCY_AUDITOR_KEYS` is defined in §5.22, but the spec does not detail how auditor signatures are collected or stored in `key_transparency_snapshots`. In Interpretation B, auditor signatures are optional external co-signatures over the STH.
