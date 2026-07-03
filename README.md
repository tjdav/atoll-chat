# Atoll Chat 🏝️

Atoll Chat is a privacy-first, zero-knowledge messaging application and personal media vault built on the [Coralite](https://coralite.dev) framework. It's designed to give you total control over your digital life, ensuring that your messages, photos, and videos stay strictly between you and your recipients.

**Note:** This project is currently a work in progress.

## Why Atoll Chat?

In an age of constant surveillance, Atoll Chat provides a sanctuary for your digital presence. We've combined cutting-edge cryptography with a seamless user experience to create a platform that is:

- **Zero-Knowledge by Design:** The server (PocketBase) is just a "dumb pipe". It never sees your plaintext messages, your keys, or your media. Everything is encrypted and decrypted locally on your device.
- **Privacy-First Messaging:** End-to-end encrypted (E2EE) chats with forward secrecy. Your identity is verified via cryptographic signatures, making it impossible for the server to forge or alter messages.
- **Your Personal Media Vault:** More than just a chat app. It's a secure space for your music, pictures, and videos. View and play your media with on-the-fly decryption directly in your browser's RAM.
- **Offline-First Reliability:** Built as a Progressive Web App (PWA) with a local IndexedDB cache. Access your messages and media even when you're off the grid.
- **Peer-to-Peer Calling:** Secure audio and video calls using E2EE signaling to negotiate direct connections between peers.

---

## The Security Model: Zero-Knowledge Flow

Atoll Chat relies on the robust [Libsodium](https://doc.libsodium.org/) library for all cryptographic operations and the **WebAuthn PRF extension** for hardware-backed security.

1.  **Vault Unlocking:** We support two primary methods to derive your high-entropy Key Encryption Key (KEK):
    -   **Biometric Passkeys (Primary):** Utilises the **WebAuthn PRF extension**. This allows your hardware security key or biometric sensor (TouchID/FaceID) to derive a site-specific secret that never leaves the hardware.
    -   **Vault PIN (Fallback):** Your 8-character secret is stretched using **Argon2id** (via `crypto_pwhash`) with interactive-grade memory and CPU limits to prevent brute-force attacks.
2.  **Local Decryption:** The derived KEK is used to decrypt your "Vault" — a JSON blob stored on the server that contains your private X25519 (encryption) and Ed25519 (identity) keys.
3.  **Message Pipeline:**
    - Every room has a unique 32-byte symmetric **Room Key**.
    - Messages are encrypted locally using `crypto_secretbox_easy`.
    - Messages are signed locally using your private identity key via `crypto_sign_detached`.
    - The server only receives the encrypted payload and the signature.
4.  **Media Handling:** Files are encrypted with a single-use symmetric key before upload. The key is then shared securely within the E2EE message itself.

---

## Developer Guide

Atoll Chat is a showcase for the **Coralite** framework, leveraging its unique approach to component-based web development.

### Architecture Highlights

- **Coralite Framework:** Utilises a specialised build pipeline that performs **AST Splicing**. Declarative HTML components are transformed into high-performance DOM operations, removing the need for heavy runtime boilerplate.
- **Serialisation Boundary:** To maintain security and performance, Coralite enforces a strict boundary. Top-level variables and imports are stripped during the build; only the `client` and `server` blocks survive to interact with the component instance.
- **Web Worker Engine:** All heavy cryptographic operations (decryption, signature verification) are offloaded to a background Web Worker. This ensures the UI remains buttery smooth even when processing large batches of messages.
- **Three-Column Pattern:** The UI follows a strict three-column architecture:
    1.  **Nav Sidebar:** Global application state.
    2.  **List Pane:** Contextual navigation (e.g., chat list, media archive).
    3.  **Detail View:** The active workspace (e.g., conversation timeline, media player).

### Getting Started

#### 1. Backend (PocketBase)
The backend is powered by PocketBase and runs in Docker.

```bash
# Start the services
pnpm run start:services
```

This will spin up a PocketBase instance at `http://localhost:8090`. The custom logic for rate-limiting and generic push notifications is located in the `database/pb_hooks/` directory.

#### 2. Frontend (Coralite)
Install the dependencies and start the development server.

```bash
pnpm install
pnpm run start:app
```

The app will be available at `http://localhost:3000`. Ensure you have Node.js installed with `--experimental-vm-modules` support (handled automatically by our scripts).

### Running Tests
We use Playwright for end-to-end testing, covering our complex cryptographic flows and multi-user interactions.

```bash
# Run all E2E tests
pnpm run test:e2e
```

---

## Getting Involved

We're building Atoll Chat in the open and would love your help! Whether you're a designer, a crypto enthusiast, or a frontend whiz, there's a place for you here.

- **Found a bug?** Open an [issue](https://github.com/atoll-chat/atoll-chat/issues).

## Licence

This project is licensed under the **[Mozilla Public License 2.0 (MPL-2.0)](./LICENSE)**.
