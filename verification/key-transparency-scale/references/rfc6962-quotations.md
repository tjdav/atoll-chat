# RFC 6962 Excerpts

## Section 2.1 — Merkle Hash Trees
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

## Section 2.1.1 — Merkle Audit Paths
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

## Section 2.1.2 — Merkle Consistency Proofs
```
2.1.2. Merkle Consistency Proofs

   Merkle consistency proofs prove the append-only property of the tree.
   A Merkle consistency proof for a Merkle Tree Hash MTH(D[n]) and a
   previously advertised hash MTH(D[0:m]) of the first m leaves, m <= n,
   is the list of nodes in the Merkle Tree required to verify that the
   first m inputs D[0:m] are equal in both trees.
```

## Section 3.2 & Section 3.5 — Signed Tree Head
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

## Section 3.5 & Section 4.5 — Merkle Audit Proof Response Format
```
4.5. Retrieve Merkle Audit Proof from Log by Leaf Hash

   GET https://<log server>/ct/v1/get-proof-by-hash

   Inputs:
      hash:  A base64-encoded v1 leaf hash.
      tree_size:  The tree_size of the tree on which to base the proof, in decimal.

   Outputs:
      leaf_index:  The 0-based index of the end entity corresponding to the "hash" parameter.
      audit_path:  An array of base64-encoded Merkle Tree nodes proving the inclusion of the chosen certificate.
```
