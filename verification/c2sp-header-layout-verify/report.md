# C2SP Header Byte Layout Empirical Verification Report

## Executive Summary

This report completes the empirical verification of the server's handling of C2SP chunked encryption headers during attachment upload, storage, and range requests.

**Classification: Answer A — The server does not parse the header.**
The server treats uploaded attachment payloads as completely opaque binary blobs. It does not inspect, parse, validate, or assume any structure regarding C2SP header bytes, salt lengths, or commitment sizes. All size validations enforced by the server (`encrypted_size`, `padded_size`, `chunk_size`, `chunk_count`) operate against client-declared metadata and physical payload byte counts. The C2SP header layout is strictly a client-side concern.

---

## 1. Server Upload Handler Flow

The attachment upload entry point is `upload` in `server/src/routes/attachments.rs`. The request body is parsed according to `Content-Type`:
- **`multipart/form-data`**: Processed via `parse_multipart` (or `parse_multipart_strict_single_file` for avatars).
- **`application/octet-stream`**: Processed via `parse_octet_stream` reading custom HTTP headers (`X-Claimed-Id`, `X-Plaintext-Size`, `X-Encrypted-Size`, `X-Chunk-Size`, `X-Chunk-Count`, `X-Nonce-Prefix`, `X-Base-Counter`, `X-Content-Type`).

Once request fields are extracted, validations are executed in `upload_attachment` (`server/src/attachments.rs`):

| Field / Aspect | Exact Server Check | Error Code on Failure | Code Location |
| :--- | :--- | :--- | :--- |
| `claimed_id` format | `len == 64` and all ASCII lowercase hex digits | `400 invalid_manifest` ("invalid claimed_id format") | `attachments.rs:104-108` |
| File Payload Length (`data.len()`) | Must be present in `config.attachment_bucket_sizes` (default `[65536, 524288, 4194304, 33554432, 268435456]`) | `413 invalid_bucket_size` | `attachments.rs:111-113` |
| `chunk_size` | Must equal `config.attachment_chunk_size` (16384 bytes) | `400 invalid_manifest` | `attachments.rs:115-120` |
| `chunk_count` | Must be > 0 | `400 invalid_manifest` | `attachments.rs:122-126` |
| `plaintext_size` | Must be > 0 and <= `encrypted_size` | `400 invalid_manifest` | `attachments.rs:128-132` |
| `nonce_prefix` | Must decode via standard base64 or URL-safe unpadded base64 to exactly 7 bytes | `400 invalid_manifest` | `attachments.rs:134-150` |
| `base_counter` | Must be in range `0..=2^32-1` | `400 invalid_manifest` | `attachments.rs:152-156` |
| `content_type` | Must be non-empty, <= 128 chars, ASCII printable non-control | `400 invalid_manifest` | `attachments.rs:158-166` |
| Hash Integrity | `SHA-256(req.data)` must equal `claimed_id` | `400 hash_mismatch` | `attachments.rs:169-178` |
| Room Membership | Caller must be present in `room_members` (for room attachments) | `404 room_not_found` | `attachments.rs:181-192` |
| Effective Size Limit | `req.data.len() as u64 <= effective_limit` | `413 file_too_large` | `routes/attachments.rs:149-154` |

---

## 2. Server C2SP Implementation Search Results

A repository-wide search was conducted for terms including `c2sp`, `chunked`, `salt`, `commitment`, `header`, `nonce_prefix`, `chunk_size`, `plaintext_size`, and `encrypted_size`.

**Findings:**
- `server/src/attachments.rs`: Implements attachment storage DTOs and validation logic. Contains zero references to salt, commitment, or header offsets.
- `server/src/routes/attachments.rs`: Implements HTTP upload, download, presign, delete, and range parsing.
- `server/src/routes/capabilities.rs`: Advertises capability `attachment_format: "c2sp-chunked-aes256gcm-v1"`.
- `server/tests/`: Integration tests verify bucket size enforcement, range requests, and hashing.

**Conclusion:** Zero code exists on the server side that parses, constructs, or validates a C2SP header.

---

## 3. Size Validation Logic

The server evaluates payload sizes using the following exact relations (`server/src/attachments.rs:111-132`):

1. **Physical Bucket Size Match:**
   `config.attachment_bucket_sizes.contains(&data.len())`
   The uploaded byte buffer length (`req.data.len()`, stored in DB as `padded_size`) must match an allowed bucket size (e.g., 64 KiB, 512 KiB, 4 MiB, 32 MiB, 256 MiB).
2. **Plaintext / Encrypted Size Bounds:**
   `0 < plaintext_size <= encrypted_size`
3. **No Header Formula or Offset:**
   The server does **not** compute or assume `encrypted_size = plaintext_size + header_size + overhead`. `encrypted_size` and `plaintext_size` are recorded directly from client manifest fields without offset validation.

---

## 4. `claimed_id` Computation

The server computes `claimed_id` as follows (`server/src/attachments.rs:169-178`):
```rust
let mut hasher = Sha256::new();
hasher.update(&req.data);
let computed_hash = hex::encode(hasher.finalize());
```
`req.data` contains **100% of the uploaded byte stream** (including any header bytes, ciphertext bytes, and trailing padding bytes). The server does not exclude or separate header bytes when hashing.

---

## 5. Chunk Size Constant

The server enforces `chunk_size == 16384` (16 KiB) in `upload_attachment` (`server/src/attachments.rs:115-120`) using `config.attachment_chunk_size`, which defaults to `16384` (`server/src/config.rs:1648`).

---

## 6. `chunk_count` Derivation

The server checks `chunk_count > 0` (`server/src/attachments.rs:122-126`). The server does **not** calculate or derive `chunk_count` from `plaintext_size`, `encrypted_size`, or payload size.

---

## 7. `nonce_prefix` Validation

The server validates `nonce_prefix` by decoding base64 (standard or URL-safe unpadded) and confirming `decoded.len() == 7` (`server/src/attachments.rs:134-150`). It is stored in the database as a string and returned in `AttachmentView` headers/JSON. The server performs no cryptographic calculations with `nonce_prefix`.

---

## 8. Test Vectors in the Codebase

All integration test suites in `server/tests/` (e.g., `attachments.rs`, `attachments_range.rs`, `user_avatar.rs`) construct dummy payloads using repeated raw bytes (e.g., `vec![0x42u8; 65536]`). No test vector or header structure assertions exist in the codebase.

---

## 9. Client Reference Implementation

No C2SP reference implementation or client helper module exists within the server repository.

---

## 10. C2SP Specification Reference

V3 Server Spec §5.13 states:
> "C2SP chunked encryption. Chunk size 16384 bytes, not configurable."

External specification: [c2sp.org/chunked-encryption](https://c2sp.org/chunked-encryption).

---

## 11. Existing Attachment Tests

- `server/tests/attachments.rs`: Bucket size checks, hash mismatch, multi-user permissions, duplicate uploads.
- `server/tests/attachments_range.rs`: HTTP Range header unit and integration tests (206 Partial Content).
- `server/tests/user_avatar.rs`: Opaque avatar upload pipe verification.
- `server/tests/attachments_presign.rs`: S3 presigned URL generation.
- `server/tests/attachment_retention.rs`: Expiration and retention pruning.

All tests treat attachment payloads as opaque byte buffers.

---

## 12. `AvatarUploadForm` / `RoomAttachmentUploadForm` Structure

Multipart form schemas (`server/src/routes/attachments.rs:411-435`) accept:
- `file`: Raw binary blob
- Manifest metadata: `claimed_id`, `plaintext_size`, `encrypted_size`, `chunk_size`, `chunk_count`, `nonce_prefix`, `base_counter`, `content_type`, `uploader_client_id`.

No distinction or separation is made between C2SP header bytes and ciphertext chunk bytes.

---

## 13. Exact Answers to Client Questions

1. **Salt length assumed by server:** Server does not parse salt.
2. **Commitment length assumed by server:** Server does not parse commitment.
3. **Header total assumed by server:** Server does not parse header.
4. **First chunk offset assumed by server:** Server does not parse chunk offset.

**Code Citations:**
- `server/src/routes/attachments.rs` (lines 140-180, 480-550)
- `server/src/attachments.rs` (lines 100-200)

---

## 14. Test Vector Construction

The server cannot provide a cryptographic C2SP test vector because it does not implement C2SP encryption/decryption. The server receives, hashes, stores, and serves raw bytes without interpreting C2SP headers.

---

## 15. Classification & Reasoning

**Classification: Answer A — The server does not parse the header.**
Reasoning: The server acts as a pure opaque blob store. It verifies byte length against allowed bucket sizes, verifies SHA-256 integrity of the entire uploaded payload against `claimed_id`, and stores metadata. It does not inspect or validate C2SP header bytes.

---

## Formal Response to the Client

**Subject: Re: Follow-up: C2SP header byte layout confirmation**

Dear Client Team,

Here is the formal confirmation regarding C2SP header byte layout handling on the server:

### 1. Answers to Your Four Layout Questions
- **Salt length assumed by server:** None (server does not parse salt).
- **Commitment length assumed by server:** None (server does not parse commitment).
- **Header total assumed by server:** None (server does not parse header).
- **First chunk offset assumed by server:** None (server does not parse chunk offset).

### 2. Codebase References
You can verify this in the open-source server repository:
- `server/src/routes/attachments.rs` (`upload`, `download`, `parse_multipart`, `parse_octet_stream`)
- `server/src/attachments.rs` (`upload_attachment`)

### 3. Test Vector
The server does not implement C2SP parsing or encryption and therefore does not generate or validate C2SP test vectors. The server receives raw byte buffers, verifies `SHA-256(bytes) == claimed_id`, and stores the payload opaquely.

### 4. Classification & Impact on Client Assumptions
**Answer A applies:** The server does not parse or validate C2SP headers.
Your proposed hardcoded layout (24-byte salt, 32-byte commitment, 56-byte header, first chunk offset 56) is **100% compatible** with the server.

### 5. Client Action Required
- **No changes required for server compatibility.**
- **Internal Consistency:** Ensure that your client-side encryption, decryption, and range-request translation (`translateRange`) use identical header offset logic. As long as your client-declared `encrypted_size` and `chunk_count` accurately reflect your client payload structure and `data.len()` lands on an allowed bucket size (e.g. 64 KiB), the server will accept and serve range requests seamlessly.
