use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogLeaf {
    pub username_token: String,
    pub identity_pubkey: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MerkleError {
    #[error("leaf index {index} out of bounds for tree size {tree_size}")]
    OutOfBounds { index: usize, tree_size: usize },
    #[error("invalid proof length for tree size {tree_size}")]
    InvalidProofLength { tree_size: usize },
}

/// Serializes a log leaf into canonical format:
/// `I2OSP(len(username_token), 2) || username_token || I2OSP(len(identity_pubkey), 2) || identity_pubkey`
pub fn serialize_leaf(username_token: &str, identity_pubkey: &str) -> Vec<u8> {
    let u_bytes = username_token.as_bytes();
    let i_bytes = identity_pubkey.as_bytes();
    let u_len = u_bytes.len() as u16;
    let i_len = i_bytes.len() as u16;

    let mut out = Vec::with_capacity(4 + u_bytes.len() + i_bytes.len());
    out.extend_from_slice(&u_len.to_be_bytes());
    out.extend_from_slice(u_bytes);
    out.extend_from_slice(&i_len.to_be_bytes());
    out.extend_from_slice(i_bytes);
    out
}

/// Computes leaf hash: `SHA-256(0x00 || leaf_bytes)`.
pub fn leaf_hash(username_token: &str, identity_pubkey: &str) -> [u8; 32] {
    let leaf_bytes = serialize_leaf(username_token, identity_pubkey);
    let mut hasher = Sha256::new();
    hasher.update([0x00]);
    hasher.update(&leaf_bytes);
    hasher.finalize().into()
}

/// Computes internal node hash: `SHA-256(0x01 || left_hash || right_hash)`.
pub fn node_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([0x01]);
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().into()
}

/// Returns the root hash for an empty tree: `SHA-256("")`.
pub fn empty_root_hash() -> [u8; 32] {
    Sha256::digest([]).into()
}

/// Calculates largest power of two strictly less than `n` (for `n > 1`).
pub fn largest_power_of_two_less_than(n: usize) -> usize {
    debug_assert!(n > 1);
    1 << (usize::BITS - 1 - (n - 1).leading_zeros())
}

/// Computes root hash over pre-calculated leaf hashes in `leaf_hashes` slice.
pub fn compute_root_from_hashes(leaf_hashes: &[[u8; 32]]) -> [u8; 32] {
    let n = leaf_hashes.len();
    if n == 0 {
        return empty_root_hash();
    }
    if n == 1 {
        return leaf_hashes[0];
    }
    let k = largest_power_of_two_less_than(n);
    let left = compute_root_from_hashes(&leaf_hashes[..k]);
    let right = compute_root_from_hashes(&leaf_hashes[k..]);
    node_hash(&left, &right)
}

/// Computes root hash for log leaves.
pub fn compute_root(leaves: &[LogLeaf]) -> [u8; 32] {
    let hashes: Vec<[u8; 32]> = leaves
        .iter()
        .map(|l| leaf_hash(&l.username_token, &l.identity_pubkey))
        .collect();
    compute_root_from_hashes(&hashes)
}

/// Generates RFC 6962 inclusion proof for `leaf_index` within `leaf_hashes`.
///
/// Returns vector of 32-byte sibling hashes ordered from leaf level up to root.
pub fn generate_inclusion_proof_from_hashes(
    leaf_hashes: &[[u8; 32]],
    leaf_index: usize,
) -> Result<Vec<[u8; 32]>, MerkleError> {
    let n = leaf_hashes.len();
    if leaf_index >= n {
        return Err(MerkleError::OutOfBounds {
            index: leaf_index,
            tree_size: n,
        });
    }
    if n == 1 {
        return Ok(Vec::new());
    }

    let k = largest_power_of_two_less_than(n);
    if leaf_index < k {
        let mut proof = generate_inclusion_proof_from_hashes(&leaf_hashes[..k], leaf_index)?;
        let right_sibling = compute_root_from_hashes(&leaf_hashes[k..]);
        proof.push(right_sibling);
        Ok(proof)
    } else {
        let mut proof = generate_inclusion_proof_from_hashes(&leaf_hashes[k..], leaf_index - k)?;
        let left_sibling = compute_root_from_hashes(&leaf_hashes[..k]);
        proof.push(left_sibling);
        Ok(proof)
    }
}

/// Generates inclusion proof for a `LogLeaf` at `leaf_index`.
pub fn generate_inclusion_proof(
    leaves: &[LogLeaf],
    leaf_index: usize,
) -> Result<Vec<[u8; 32]>, MerkleError> {
    let hashes: Vec<[u8; 32]> = leaves
        .iter()
        .map(|l| leaf_hash(&l.username_token, &l.identity_pubkey))
        .collect();
    generate_inclusion_proof_from_hashes(&hashes, leaf_index)
}

/// Verifies an inclusion proof for `target_leaf_hash` at `leaf_index` in tree of `tree_size`.
pub fn verify_inclusion_proof(
    target_leaf_hash: &[u8; 32],
    leaf_index: usize,
    tree_size: usize,
    proof: &[[u8; 32]],
    expected_root_hash: &[u8; 32],
) -> Result<bool, MerkleError> {
    if leaf_index >= tree_size {
        return Err(MerkleError::OutOfBounds {
            index: leaf_index,
            tree_size,
        });
    }

    let calculated_root = evaluate_proof_path(target_leaf_hash, leaf_index, tree_size, proof, 0)?;
    Ok(&calculated_root == expected_root_hash)
}

fn evaluate_proof_path(
    current_hash: &[u8; 32],
    index: usize,
    size: usize,
    proof: &[[u8; 32]],
    proof_offset: usize,
) -> Result<[u8; 32], MerkleError> {
    if size == 1 {
        if proof_offset != proof.len() {
            return Err(MerkleError::InvalidProofLength { tree_size: size });
        }
        return Ok(*current_hash);
    }

    if proof_offset >= proof.len() {
        return Err(MerkleError::InvalidProofLength { tree_size: size });
    }

    let k = largest_power_of_two_less_than(size);
    let sibling = proof[proof.len() - 1 - proof_offset];

    if index < k {
        let left_root = evaluate_proof_path(current_hash, index, k, proof, proof_offset + 1)?;
        Ok(node_hash(&left_root, &sibling))
    } else {
        let right_root =
            evaluate_proof_path(current_hash, index - k, size - k, proof, proof_offset + 1)?;
        Ok(node_hash(&sibling, &right_root))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_leaf(id: usize) -> LogLeaf {
        LogLeaf {
            username_token: format!("token_{id}"),
            identity_pubkey: format!("pubkey_{id}"),
        }
    }

    #[test]
    fn test_power_of_two_helper() {
        assert_eq!(largest_power_of_two_less_than(2), 1);
        assert_eq!(largest_power_of_two_less_than(3), 2);
        assert_eq!(largest_power_of_two_less_than(4), 2);
        assert_eq!(largest_power_of_two_less_than(5), 4);
        assert_eq!(largest_power_of_two_less_than(7), 4);
        assert_eq!(largest_power_of_two_less_than(8), 4);
        assert_eq!(largest_power_of_two_less_than(9), 8);
    }

    #[test]
    fn test_empty_tree() {
        let root = compute_root(&[]);
        assert_eq!(root, empty_root_hash());
    }

    #[test]
    fn test_single_leaf_tree() {
        let leaves = vec![make_leaf(0)];
        let root = compute_root(&leaves);
        let expected = leaf_hash(&leaves[0].username_token, &leaves[0].identity_pubkey);
        assert_eq!(root, expected);

        let proof = generate_inclusion_proof(&leaves, 0).unwrap();
        assert!(proof.is_empty());
        assert!(verify_inclusion_proof(&expected, 0, 1, &proof, &root).unwrap());
    }

    #[test]
    fn test_two_leaf_tree() {
        let leaves = vec![make_leaf(0), make_leaf(1)];
        let h0 = leaf_hash(&leaves[0].username_token, &leaves[0].identity_pubkey);
        let h1 = leaf_hash(&leaves[1].username_token, &leaves[1].identity_pubkey);
        let expected_root = node_hash(&h0, &h1);

        let root = compute_root(&leaves);
        assert_eq!(root, expected_root);

        // Proof for leaf 0
        let p0 = generate_inclusion_proof(&leaves, 0).unwrap();
        assert_eq!(p0, vec![h1]);
        assert!(verify_inclusion_proof(&h0, 0, 2, &p0, &root).unwrap());

        // Proof for leaf 1
        let p1 = generate_inclusion_proof(&leaves, 1).unwrap();
        assert_eq!(p1, vec![h0]);
        assert!(verify_inclusion_proof(&h1, 1, 2, &p1, &root).unwrap());
    }

    #[test]
    fn test_three_leaf_tree_rfc6962_split() {
        let leaves = vec![make_leaf(0), make_leaf(1), make_leaf(2)];
        let h0 = leaf_hash(&leaves[0].username_token, &leaves[0].identity_pubkey);
        let h1 = leaf_hash(&leaves[1].username_token, &leaves[1].identity_pubkey);
        let h2 = leaf_hash(&leaves[2].username_token, &leaves[2].identity_pubkey);

        let left_branch = node_hash(&h0, &h1);
        let expected_root = node_hash(&left_branch, &h2);

        let root = compute_root(&leaves);
        assert_eq!(root, expected_root);

        for idx in 0..3 {
            let target = leaf_hash(&leaves[idx].username_token, &leaves[idx].identity_pubkey);
            let proof = generate_inclusion_proof(&leaves, idx).unwrap();
            assert!(
                verify_inclusion_proof(&target, idx, 3, &proof, &root).unwrap(),
                "failed proof verification for leaf {idx}"
            );
        }
    }

    #[test]
    fn test_multiple_tree_sizes_proof_verification() {
        for size in [1, 2, 3, 4, 7, 8, 15, 16, 21] {
            let leaves: Vec<LogLeaf> = (0..size).map(make_leaf).collect();
            let root = compute_root(&leaves);

            for idx in 0..size {
                let target = leaf_hash(&leaves[idx].username_token, &leaves[idx].identity_pubkey);
                let proof = generate_inclusion_proof(&leaves, idx).unwrap();
                assert!(
                    verify_inclusion_proof(&target, idx, size, &proof, &root).unwrap(),
                    "size {size}, index {idx} proof verification failed"
                );
            }
        }
    }

    #[test]
    fn test_out_of_bounds_proof() {
        let leaves = vec![make_leaf(0), make_leaf(1)];
        let res = generate_inclusion_proof(&leaves, 2);
        assert_eq!(
            res,
            Err(MerkleError::OutOfBounds {
                index: 2,
                tree_size: 2
            })
        );
    }
}
