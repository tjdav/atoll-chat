use base64::Engine;
use hkdf::Hkdf;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use server::oprf::{OprfEvaluator, OprfKeys};
use server::DefaultCipherSuite;
use sha2::{Digest, Sha256};
use voprf::{OprfClient, OprfServer, Ristretto255};

#[test]
fn test_oprf_keys_deterministic() {
    let mut rng = OsRng;
    let setup = ServerSetup::<DefaultCipherSuite>::new(&mut rng);

    let keys1 = OprfKeys::load(&setup).unwrap();
    let keys2 = OprfKeys::load(&setup).unwrap();

    let eval1 = OprfEvaluator::new(&keys1);
    let eval2 = OprfEvaluator::new(&keys2);

    let blind_result = OprfClient::<Ristretto255>::blind(b"alice", &mut rng).unwrap();
    let blinded_b64 =
        base64::engine::general_purpose::STANDARD.encode(blind_result.message.serialize());

    let res1 = eval1.evaluate_blinded(&blinded_b64).unwrap();
    let res2 = eval2.evaluate_blinded(&blinded_b64).unwrap();

    assert_eq!(res1, res2);
}

#[test]
fn test_oprf_keys_derivation_spec_equivalence() {
    let mut rng = OsRng;
    let setup = ServerSetup::<DefaultCipherSuite>::new(&mut rng);

    // 1. OprfKeys load
    let keys = OprfKeys::load(&setup).unwrap();
    let evaluator = OprfEvaluator::new(&keys);

    // 2. Manual derivation
    let serialized_bytes = setup.serialize();
    let root_secret = Sha256::digest(serialized_bytes);

    let hk = Hkdf::<Sha256>::new(None, &root_secret);
    let mut username_key = [0u8; 32];
    hk.expand(b"username-oprf-v1", &mut username_key).unwrap();

    let manual_server =
        OprfServer::<Ristretto255>::new_from_seed(&username_key, b"username-oprf-v1").unwrap();

    // 3. Compare evaluation on fixed input
    let blind_result = OprfClient::<Ristretto255>::blind(b"bob", &mut rng).unwrap();
    let blinded_b64 =
        base64::engine::general_purpose::STANDARD.encode(blind_result.message.serialize());

    let eval_res = evaluator.evaluate_blinded(&blinded_b64).unwrap();

    let decoded_blinded = base64::engine::general_purpose::STANDARD
        .decode(&blinded_b64)
        .unwrap();
    let blinded_elem =
        voprf::BlindedElement::<Ristretto255>::deserialize(&decoded_blinded).unwrap();
    let manual_eval_elem = manual_server.blind_evaluate(&blinded_elem);
    let manual_res = base64::engine::general_purpose::STANDARD.encode(manual_eval_elem.serialize());

    assert_eq!(eval_res, manual_res);
}

#[test]
fn test_different_server_setups_produce_different_keys() {
    let mut rng = OsRng;
    let setup1 = ServerSetup::<DefaultCipherSuite>::new(&mut rng);
    let setup2 = ServerSetup::<DefaultCipherSuite>::new(&mut rng);

    let keys1 = OprfKeys::load(&setup1).unwrap();
    let keys2 = OprfKeys::load(&setup2).unwrap();

    let eval1 = OprfEvaluator::new(&keys1);
    let eval2 = OprfEvaluator::new(&keys2);

    let blind_result = OprfClient::<Ristretto255>::blind(b"charlie", &mut rng).unwrap();
    let blinded_b64 =
        base64::engine::general_purpose::STANDARD.encode(blind_result.message.serialize());

    let res1 = eval1.evaluate_blinded(&blinded_b64).unwrap();
    let res2 = eval2.evaluate_blinded(&blinded_b64).unwrap();

    assert_ne!(res1, res2);
}
