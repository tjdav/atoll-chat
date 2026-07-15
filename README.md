# Atoll Chat 🏝️

Atoll Chat is a privacy-first, zero-knowledge messaging application and personal media vault built on the [Coralite](https://coralite.dev) framework. It's designed to give you total control over your digital life, ensuring that your messages, photos, and videos stay strictly between you and your recipients.

[![Licence: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](./LICENSE)
![Status: Work In Progress](https://img.shields.io/badge/Status-Work_In_Progress-orange)

## Why Atoll Chat?

In an age of constant surveillance, Atoll Chat provides a sanctuary for your digital presence. We've combined cutting-edge cryptography with a seamless user experience to create a platform that is:

- **Zero-Knowledge by Design:** The server (PocketBase) is just a "dumb pipe". It never sees your plaintext messages, your keys, or your media. Everything is encrypted and decrypted locally on your device.
- **Privacy-First Messaging:** End-to-end encrypted (E2EE) chats with forward secrecy. Your identity is verified via cryptographic signatures, making it impossible for the server to forge or alter messages.
- **Your Personal Media Vault:** More than just a chat app. It's a secure space for your music, pictures, and videos. View and play your media with on-the-fly decryption directly in your browser's RAM.
- **Offline-First Reliability:** Built as a Progressive Web App (PWA) with a local IndexedDB cache. Access your messages and media even when you're off the grid.
- **Peer-to-Peer Calling:** Secure audio and video calls using E2EE signaling to negotiate direct connections between peers.

---

## Key Features

Atoll Chat is packed with powerful, privacy-preserving features designed to run securely client-side:

### Cryptography & Security
*   **Zero-Knowledge Architecture:** Cryptographic operations are performed locally using [Libsodium](https://doc.libsodium.org/) inside a background Web Worker, ensuring a completely unblocked UI.
*   **Biometric Passkeys (WebAuthn PRF):** Hardware-backed key derivation using the WebAuthn PRF extension. Log in or unlock your vault with biometrics (e.g., TouchID/FaceID) or hardware keys (e.g., YubiKey) without exposing secrets to the server.
*   **Argon2id Key Stretching:** High-entropy key derivation for fallback Vault PINs using the Argon2id hashing algorithm via Libsodium.
*   **Multi-Factor Authentication (TOTP):** Two-factor authentication support with native QR code generation and verification.
*   **E2EE Room Keys:** Every chat room is secured by a unique 32-byte symmetric Room Key with local message signing for identity verification.

### End-to-End Encrypted Messaging
*   **Encrypted Chat Rooms:** Real-time text messaging with full E2EE room capabilities.
*   **Message Reactions:** React to messages using rich, secure emoji reactions.
*   **Interactive Voice Messages:** Record and send inline voice messages. Includes a custom waveform visualizer generated on-the-fly using the Web Audio API to analyze audio peaks.
*   **Rich Previews & Markdown:** Write messages in Markdown and view rich inline previews for URLs.
*   **Room Customization:** Create, edit, configure, or leave chat rooms. Update room names, avatars, and member permissions securely.
*   **Jump-to-Chat:** A global modal to quickly search and switch between active chat rooms.

### Personal Media Vault
*   **Encrypted Media Storage:** Securely store, view, and play pictures, videos, music, and documents.
*   **On-the-Fly RAM Decryption:** Files are decrypted dynamically inside browser RAM and cached locally using IndexedDB for ultra-secure access.
*   **Custom Media Players:** Secure, client-side players for audio and video, including Picture-in-Picture (PiP) support.
*   **Shared Links & Documents:** Access dedicated views of all links, documents, and media shared across individual chat rooms.

### Peer-to-Peer Calls & WebRTC
*   **E2EE Audio & Video Calls:** Direct, peer-to-peer calling using end-to-end encrypted signaling messages over PocketBase.
*   **Direct File Transfer:** Send large files directly to peers using WebRTC, avoiding cloud storage upload sizes and speeds.
*   **Fallback STUN/TURN:** Automatic STUN/TURN server fallback (orchestrated via Coturn) to guarantee reliable connections across firewalls and NATs.

### Multi-Platform & Offline Reliability
*   **Progressive Web App (PWA):** Installs natively on desktop and mobile devices.
*   **Capacitor Native Apps:** Ready for Android and iOS wrapper deployments.
*   **Offline-First Cache:** Full IndexedDB offline caching allows reading chats, composing queued messages, and viewing cached media without an active internet connection.
*   **Multi-Tab Sync:** Synchronize application state and database updates seamlessly across multiple browser tabs.

---

## The Security Model: Zero-Knowledge Flow

Atoll Chat relies on the robust [Libsodium](https://doc.libsodium.org/) library for all cryptographic operations and the **WebAuthn PRF extension** for hardware-backed security.

1.  **Vault Unlocking:** We support two primary methods to derive your high-entropy Key Encryption Key (KEK):
    -   **Biometric Passkeys (Primary):** Utilises the **WebAuthn PRF extension**. This allows your hardware security key or biometric sensor (TouchID/FaceID) to derive a site-specific secret that never leaves the hardware.
    -   **Vault PIN (Fallback):** Your secret is stretched using **Argon2id** (via `crypto_pwhash`) with interactive-grade memory and CPU limits to prevent brute-force attacks.
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

#### 1. Quick Start Dev Environment (Recommended)

To spin up the entire development environment including a mock PocketBase server, local Coturn TURN server container, and the frontend dev server running on `http://localhost:3000`:

```bash
# Install dependencies
pnpm install

# Start database services & app dev server
pnpm start
```

#### 2. Running Services Separately

If you prefer to run services individually:

*   **Database & TURN Service:**
    ```bash
    pnpm run start:database
    ```
    This spins up the production-ready Docker containers (PocketBase on port `8080` and Coturn on port `3478`).
    
*   **Frontend Development Server:**
    ```bash
    pnpm run start:app
    ```
    Runs the Coralite dev server at `http://localhost:3000`. Ensure Node.js is executed with `--experimental-vm-modules` support (handled automatically by our scripts).

*   **Production Build:**
    ```bash
    pnpm run build
    ```
    Compiles the frontend to the `./dist` folder, ready for deployment or serving via PocketBase's public directory.

### Running Tests & Linting

Our codebase implements extensive E2E testing using Playwright to cover hardware security keys, cryptographic flows, and real-time room communication.

```bash
# Run unit tests
pnpm run test:unit

# Run all E2E tests in headless mode
pnpm run test:e2e

# Run E2E tests in interactive UI mode
pnpm run test:e2e:ui

# Check TypeScript definitions
pnpm run lint:types

# Lint and fix style formatting issues
pnpm run lint:format
```

---

## Getting Involved

We're building Atoll Chat in the open and would love your help! Whether you're a designer, a crypto enthusiast, or a frontend whiz, there's a place for you here.

- **Found a bug?** Open an [issue](https://codeberg.org/tjdavid/atoll-chat/issues).
