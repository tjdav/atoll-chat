mod common;

use common::setup_test_app;
use server::sync::allocate_user_seq;

#[tokio::test]
async fn test_allocate_user_seq_basic() {
    let (_app, pool) = setup_test_app().await;
    let user_a = "usr_a_test";
    let user_b = "usr_b_test";

    // Insert dummy user rows so foreign key constraint is satisfied
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)")
        .bind(user_a)
        .bind("token_a")
        .bind(vec![1u8, 2, 3])
        .bind("pubkey_a")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)")
        .bind(user_b)
        .bind("token_b")
        .bind(vec![1u8, 2, 3])
        .bind("pubkey_b")
        .execute(&pool)
        .await
        .unwrap();

    // 1. First allocation returns 1
    let mut tx = pool.begin().await.unwrap();
    let seq_a1 = allocate_user_seq(&mut tx, user_a).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_a1, 1);

    // 2. Second allocation returns 2
    let mut tx = pool.begin().await.unwrap();
    let seq_a2 = allocate_user_seq(&mut tx, user_a).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_a2, 2);

    // 3. Sequence increments across transactions
    let mut tx = pool.begin().await.unwrap();
    let seq_a3 = allocate_user_seq(&mut tx, user_a).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_a3, 3);

    // 4. Different users have independent sequences
    let mut tx = pool.begin().await.unwrap();
    let seq_b1 = allocate_user_seq(&mut tx, user_b).await.unwrap();
    let seq_b2 = allocate_user_seq(&mut tx, user_b).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_b1, 1);
    assert_eq!(seq_b2, 2);
}

#[tokio::test]
async fn test_allocate_user_seq_concurrency() {
    let (_app, pool) = setup_test_app().await;
    let user_a = "usr_a_conc";

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)")
        .bind(user_a)
        .bind("token_a_conc")
        .bind(vec![1u8, 2, 3])
        .bind("pubkey_conc")
        .execute(&pool)
        .await
        .unwrap();

    // 5. Concurrent allocations for same user
    let pool1 = pool.clone();
    let pool2 = pool.clone();
    let user_id1 = user_a.to_string();
    let user_id2 = user_a.to_string();

    let handle1 = tokio::spawn(async move {
        let mut tx = pool1.begin().await.unwrap();
        let seq = allocate_user_seq(&mut tx, &user_id1).await.unwrap();
        tx.commit().await.unwrap();
        seq
    });

    let handle2 = tokio::spawn(async move {
        let mut tx = pool2.begin().await.unwrap();
        let seq = allocate_user_seq(&mut tx, &user_id2).await.unwrap();
        tx.commit().await.unwrap();
        seq
    });

    let seq1 = handle1.await.unwrap();
    let seq2 = handle2.await.unwrap();

    assert!((seq1 == 1 && seq2 == 2) || (seq1 == 2 && seq2 == 1));

    // Verify next allocation is 3
    let mut tx = pool.begin().await.unwrap();
    let seq_next = allocate_user_seq(&mut tx, user_a).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_next, 3);
}

#[tokio::test]
async fn test_allocate_user_seq_rollback() {
    let (_app, pool) = setup_test_app().await;
    let user_a = "usr_a_rb";

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)")
        .bind(user_a)
        .bind("token_a_rb")
        .bind(vec![1u8, 2, 3])
        .bind("pubkey_rb")
        .execute(&pool)
        .await
        .unwrap();

    // 7. Allocation rolls back with transaction
    let mut tx = pool.begin().await.unwrap();
    let seq = allocate_user_seq(&mut tx, user_a).await.unwrap();
    assert_eq!(seq, 1);
    tx.rollback().await.unwrap();

    let mut tx2 = pool.begin().await.unwrap();
    let seq2 = allocate_user_seq(&mut tx2, user_a).await.unwrap();
    tx2.commit().await.unwrap();
    assert_eq!(seq2, 1);
}
