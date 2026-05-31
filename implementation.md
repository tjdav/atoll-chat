
## phase 1: Foundation & Cryptographic Engine
Objective: Establish the secure environment, build the plugin ecosystem, and implement zero-knowledge user registration.

### track 1.1: Core Infrastructure

#### task 1.1.1: Initialize the Coralite project and configure the build pipeline
- Scaffold the project using the official `pnpm create coralite` CLI tool.
- Utilize `coralite-scripts` for the dev server and build pipeline.
- Configure the framework's core AST plugins and set up the main HTML entry point.

##### Jules prompt
> **Goal:** Scaffold the `atoll chat` project using the official Coralite CLI, configure the `coralite-scripts` build pipeline, and prepare the main SPA entry page.
> 
> **Instructions:** > You are initializing the codebase for `atoll chat`, a zero-knowledge End-to-End Encrypted chat PWA using the Coralite framework. We are using the official `create-coralite` scaffolding tool.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. **NO VANILLA BOILERPLATE:** Never write standard `customElements.define()` or `class extends HTMLElement` blocks. You MUST always use Coralite's `defineComponent` exported from `coralite`.
> 2. **AST SPLICING AWARENESS:** If a component is written declaratively in HTML, the server completely deletes the host tag and replaces it with the template's inner HTML.
> 3. **SERIALIZATION BOUNDARY:** You cannot use top-level imports or variables (declared outside `defineComponent`) directly inside the `script` block.
> 
> **1. task: Scaffold the Project**
> - Provide the command to initialize the project: `pnpm create coralite atoll-chat`.
> - Explain that this automatically sets up `coralite-scripts` (handling the dev server and build process) and the default directory structure (`/src/pages`, `/src/components`, `/public`).
> - Ensure `"type": "module"` is configured in the generated `package.json`.
> 
> **2. task: Configure the Build Pipeline (`coralite.config.js`)**
> - Create or modify the `coralite.config.js` file at the project root (which `coralite-scripts` consumes).
> - Register the plugins in the configuration object.
> - Configure `staticAssetPlugin` to map the `/public/` directory to the build output root.
> 
> **3. task: The Entry Page (`src/pages/index.html`)**
> - Create the main Single Page Application (SPA) shell in `src/pages/index.html`.
> - Write the standard HTML5 boilerplate with necessary PWA `<meta>` tags (e.g., `viewport` set to `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`).
> - Inside the `<body>`, place the un-implemented root component tag: `<app-layout></app-layout>`.
> - Do not write any inline JavaScript; rely entirely on Coralite's static analysis and `coralite-scripts` to inject the component bundles.

#### task 1.1.2: Implement the `pocketbasePlugin` (SDK Singleton)

* Install the `pocketbase` JavaScript SDK.
* Create a Coralite plugin to instantiate a single PocketBase client.
* Expose the initialized `pb` instance to all component `script` setups to prevent multiple Server-Sent Events (SSE) connections and synchronize auth $state globally.

##### Jules prompt

> **Goal:** Create the `pocketbasePlugin` to provide a singleton PocketBase SDK instance across the Coralite application.
> **Instructions:**
> You are building a custom plugin for the Coralite framework to integrate PocketBase.
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `definePlugin` from `coralite` to construct the plugin.
> 2. The plugin must initialize the PocketBase instance ONCE in the global setup phase of the plugin closure.
> 3. The plugin must inject that single instance into the `client.context` so components can access it directly in their setup block via `({ pb }) => {}`.
> 
> 
> **1. task: Dependency**
> * Instruct the user to install the SDK via standard package managers: `pnpm add pocketbase`.
> 
> 
> **2. task: Plugin Implementation (`src/plugins/pocketbasePlugin.js`)**
> * Write the plugin code using `definePlugin`.
> * Import `PocketBase` from the installed package.
> * Within the `client.context` definition, declare `const pb = new PocketBase('http://127.0.0.1:8090')` (or use an environment variable) at the global level so it acts as a singleton.
> * Return the `pb` instance in the context mapper function: `pb: () => pb`.
> 
> 
> **3. task: Registration instructions**
> * Provide a brief instruction on how to register this new plugin inside the `coralite.config.js`

#### task 1.1.3: Implement the `$statePlugin` and `eventBusPlugin`
- Create the global event bus (`$bus`) using the auto-cleaning `EventTarget` and `AbortSignal` pattern to prevent memory leaks.
- Create the `$statePlugin` to provide a reactive primitive tied to the component lifecycle.
- Register both plugins in the Coralite configuration.

##### Jules prompt
> **Goal:** Build the core $state management and communication layer by implementing the `eventBusPlugin` and `$statePlugin`.
> 
> **Instructions:**
> You are building application-level plugins for `atoll chat` using the Coralite framework.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `definePlugin` from `coralite`.
> 2. Plugins run their outer scope globally (once) and their returned inner function per-component instance, receiving the `instanceContext`.
> 
> **1. task: The Event Bus Plugin (`src/plugins/eventBusPlugin.js`)**
> - Create a plugin named `event-bus`.
> - In the global closure of the `client.context.$bus` definition, initialize a singleton hub: `const hub = new EventTarget();`.
> - Return the instance injector function `(instanceContext) => { ... }`.
> - Within the injector, return an object with two methods:
>   - `emit: (eventName, payload) => { hub.dispatchEvent(new CustomEvent(eventName, { detail: payload })); }`
>   - `on: (eventName, callback) => { ... }` 
> - **CRITICAL:** Inside the `on` method, wrap the callback and attach it to the `hub` using `addEventListener`, explicitly passing `{ signal: instanceContext.signal }` to guarantee automatic garbage collection when the Coralite component unmounts.
> 
> **2. task: The $state Plugin (`src/plugins/statePlugin.js`)**
> - Create a plugin named `app-state`.
> - In the global closure, define a shared reactive store object. (Use a standard JavaScript `Proxy` or a lightweight signal pattern to track changes).
> - Return the instance injector function mapping to `client.context.state`.
> - Ensure the returned $state object allows components to read and write shared data (like `currentUser`, `activeRoomId`, or `connectionStatus`).
> 
> **3. task: Registration**
> - Provide the updated `coralite.config.js` code demonstrating how to import and register `eventBusPlugin` and `$statePlugin` alongside the existing plugins.

### track 1.2: Identity & Vaulting

#### task 1.2.1: Build the Key Derivation Function (KDF) utilities
- Create a dedicated cryptography utility module for deriving the Key Encryption Key (KEK).
- Implement the fallback Argon2id key derivation using Libsodium for 6-digit PINs.
- Implement the primary WebAuthn PRF (Pseudo-Random Function) derivation for biometric passkeys.

##### Jules prompt
> **Goal:** Build the pure JavaScript utility module that handles Key Derivation (Argon2id and WebAuthn PRF) to generate the Key Encryption Key (KEK).
> 
> **Instructions:**
> You are building the core cryptographic utility for `atoll chat`. This is a pure JavaScript module (`src/utils/cryptoUtils.js`), NOT a Coralite component. 
> 
> **1. task: Argon2id Derivation (Fallback Method)**
> - Export an async function `deriveKeyFromPin(pin, saltUint8Array, sodium)`.
> - Use `sodium.crypto_pwhash` to stretch the PIN into a 32-byte (256-bit) Key Encryption Key.
> - **CRITICAL PARAMETERS:** You must use `sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE`, `sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE`, and `sodium.crypto_pwhash_ALG_ARGON2ID13`.
> - Return the derived 32-byte `Uint8Array`.
> 
> **2. task: WebAuthn PRF (Primary Biometric Method)**
> - Export an async function `deriveKeyFromPasskey(credentialId, challengeBuffer, saltBuffer)`.
> - Utilize the standard Web Authentication API (`navigator.credentials.get`).
> - Provide the `credentialId` in the `allowCredentials` array.
> - **CRITICAL EXTENSION:** You must include the `extensions: { prf: { eval: { first: saltBuffer } } }` object in the assertion request.
> - Extract the derived bytes from the assertion response: `assertion.getClientExtensionResults().prf.results.first`.
> - If the browser does not support PRF, the function should throw a clear error prompting the app to fall back to the PIN method.
> - Return the derived 32-byte `Uint8Array`.
> 
> **3. task: Salt Generation Helper**
> - Export a simple helper `generateSalt(sodium)` that uses `sodium.randombytes_buf(16)` to return a standard 16-byte cryptographically secure salt.

#### task 1.2.2: Implement Master Keypair generation (`crypto_box` and `crypto_sign`)
- Expand the cryptography utility module to handle the generation of asymmetric keys.
- Implement the X25519 keypair generation for End-to-End Encryption payloads.
- Implement the Ed25519 keypair generation for cryptographic identity signatures.
- Ensure keys are securely serialized to base64 for storage and transport.

##### Jules prompt
> **Goal:** Build the JavaScript utility functions to generate the dual Master Keypairs (Encryption and Identity) using Libsodium.
> 
> **Instructions:**
> You are continuing to build the core cryptographic utility module (`src/utils/cryptoUtils.js`) for `atoll chat`.
> 
> **1. task: Encryption Keypair (X25519)**
> - Export a function `generateEncryptionKeys(sodium)`.
> - Utilize `sodium.crypto_box_keypair()` to generate the X25519 keypair.
> - Convert both the `publicKey` and `privateKey` `Uint8Array` buffers to base64 strings using `sodium.to_base64(key)`.
> - Return an object containing `{ publicKey, privateKey }`.
> 
> **2. task: Identity Keypair (Ed25519)**
> - Export a function `generateIdentityKeys(sodium)`.
> - Utilize `sodium.crypto_sign_keypair()` to generate the Ed25519 keypair.
> - Convert both the `publicKey` and `privateKey` buffers to base64 strings using `sodium.to_base64(key)`.
> - Return an object containing `{ publicKey, privateKey }`.
> 
> **3. task: Unified Generation Helper**
> - Export an async helper `generateMasterKeys(sodium)` that calls both of the above functions.
> - Return a structured object matching the `atoll chat` database requirements: 
>   `{ public_box_key, private_box_key, public_sign_key, private_sign_key }`.
> - This structured output will make it much easier for the UI components to bundle these keys into the Vault in the next step.

#### task 1.2.3: Build the JSON Vault encryption/decryption logic using the derived KEK
- Expand the cryptography utility module to handle securing the private keys.
- Implement a function to symmetrically encrypt the private keys into a JSON string using the KEK.
- Implement a function to decrypt and parse the JSON Vault back into usable private keys.

##### Jules prompt
> **Goal:** Build the JavaScript utility functions to encrypt and decrypt the user's private keys (the Vault) using their Key Encryption Key (KEK) and Libsodium.
> 
> **Instructions:**
> You are continuing to build the core cryptographic utility module (`src/utils/cryptoUtils.js`) for `atoll chat`.
> 
> **1. task: Encrypt the Vault**
> - Export a function `encryptVault(privateKeysObject, kek, sodium)`. 
> - The `privateKeysObject` will contain `{ private_box_key, private_sign_key }`. Convert this object to a JSON string.
> - Generate a random 24-byte nonce using `sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)`.
> - Encrypt the JSON string using `sodium.crypto_secretbox_easy(jsonString, nonce, kek)`.
> - Return an object containing the base64 encoded payload: `{ vault_ciphertext: sodium.to_base64(ciphertext), vault_nonce: sodium.to_base64(nonce) }`.
> 
> **2. task: Decrypt the Vault**
> - Export a function `decryptVault(vaultCiphertextBase64, vaultNonceBase64, kek, sodium)`.
> - Convert the base64 inputs back to `Uint8Array` buffers using `sodium.from_base64()`.
> - Decrypt the payload using `sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, kek)`.
> - Convert the decrypted buffer back to a string (using standard `TextDecoder` or Libsodium string utilities).
> - Parse the string back into a JSON object and return it: `{ private_box_key, private_sign_key }`.
> - Ensure you wrap the decryption step in a `try/catch` block. If `crypto_secretbox_open_easy` fails, it means the user entered the wrong PIN/Passkey (invalid KEK), so throw a clear "Invalid Credentials" error.

### track 1.3: Auth UI (`index.html` & `<auth-view>`)

#### task 1.3.1: Build the Registration component (`<auth-register>`)
- Create a Coralite component for user registration.
- Build the HTML form to capture the desired username and a 6-digit PIN (or trigger WebAuthn).
- Wire up the form submission to utilize the cryptographic utilities built in Track 1.2.
- Prepare the structured payload to be sent to PocketBase.

##### Jules prompt
> **Goal:** Build the `<auth-register>` Coralite component that orchestrates key generation and vault encryption upon user sign-up.
> 
> **Instructions:**
> You are building the registration UI for `atoll chat` using the Coralite framework. This component will be located at `src/components/auth-register.html` (or `.js` depending on your preferred Coralite single-file component style).
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. **NO TOP-LEVEL VARIABLES:** Inside the `script: ({ refs, pb, $bus }) => {}` context, you must dynamically import your utilities (`await import('../utils/cryptoUtils.js')`).
> 3. Use the `refsPlugin` to interact with the DOM elements (`refs('usernameInput')`).
> 
> **1. task: Template Construction**
> - Define the HTML template.
> - Include a form with an input for `username` (text) and an input for `pin` (password, minlength 6).
> - Add `ref` attributes to the form and inputs (e.g., `<form ref="registerForm">`, `<input ref="username">`, `<input ref="pin">`).
> - Include a submit button and a status text area `<div ref="statusMsg"></div>` to show progress to the user (e.g., "Generating keys...").
> 
> **2. task: Component Setup & Imports**
> - Define the `script` block requesting `refs`, `pb` (from `pocketbasePlugin`), and `$bus` (from `eventBusPlugin`) in the context destructing.
> - Inside the setup function, attach a `submit` event listener to the form ref. Prevent the default form submission.
> - Dynamically import the `cryptoUtils.js` module and the `libsodium-wrappers` module. Await `sodium.ready`.
> 
> **3. task: Cryptographic Orchestration**
> - On submit, read the username and PIN.
> - Update the status message to "Generating cryptographic keys...".
> - Call `generateMasterKeys(sodium)` from the utility module.
> - Call `generateSalt(sodium)` to get a `pin_salt`.
> - Update status to "Securing vault...".
> - Call `deriveKeyFromPin(pin, pin_salt, sodium)` to get the KEK.
> - Call `encryptVault(privateKeys, KEK, sodium)`.
> 
> **4. task: Payload Construction & Dispatch**
> - Construct the payload object matching the PocketBase `users` collection schema: `{ username, public_box_key, public_sign_key, pin_salt, encrypted_master_keys }`.
> - (Mock the actual PocketBase `create` call for now, or just log the payload to the console).
> - Emit a successful registration event using `$bus.emit('auth:registered', payload)` to notify the parent application $state to transition views.

#### task 1.3.2: Build the Login view (fetching salt, deriving KEK, unlocking vault into RAM)
- Create a Coralite component for user login.
- Build the HTML form to capture the username and PIN.
- Wire up the form to fetch the user's salt from PocketBase.
- Derive the Key Encryption Key (KEK) locally and decrypt the zero-knowledge vault into volatile memory.

##### Jules prompt
> **Goal:** Build the `<auth-login>` Coralite component that orchestrates fetching the user's salt, deriving the KEK, and unlocking the cryptographic vault.
> 
> **Instructions:**
> You are building the login UI for `atoll chat` using the Coralite framework. This component will be located at `src/components/auth-login.html` (or `.js`).
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. **NO TOP-LEVEL VARIABLES:** Inside the `script: ({ refs, pb, $bus }) => {}` context, you must dynamically import your utilities (`await import('../utils/cryptoUtils.js')`).
> 3. Use the `refsPlugin` to interact with the DOM elements.
> 
> **1. task: Template Construction**
> - Define the HTML template with a form containing `username` and `pin` inputs.
> - Add `ref` attributes (e.g., `<form ref="loginForm">`, `<input ref="username">`, `<input ref="pin">`).
> - Include a submit button and a `<div ref="statusMsg"></div>` for user feedback.
> 
> **2. task: Component Setup & Imports**
> - Define the `script` block requesting `refs`, `pb`, and `$bus` from the injected context.
> - Attach a `submit` event listener to the form to prevent default submission.
> - Dynamically import the `cryptoUtils.js` module and the `libsodium-wrappers` module. Await `sodium.ready`.
> 
> **3. task: Fetching the Salt & Vault**
> - On submit, read the username and PIN. Update status to "Locating account...".
> - Query PocketBase for the user record matching the inputted username: `await pb.collection('users').getFirstListItem(\`username="\${username}"\`)`.
> - Extract `pin_salt` and `encrypted_master_keys` from the fetched record.
> 
> **4. task: Cryptographic Unlocking**
> - Update status to "Unlocking secure vault...".
> - Call `deriveKeyFromPin(pin, pin_salt, sodium)` to reconstruct the KEK locally.
> - Call `decryptVault(encrypted_master_keys.vault_ciphertext, encrypted_master_keys.vault_nonce, KEK, sodium)`.
> - **Error Handling:** Wrap the decryption in a `try/catch`. If it fails, catch the error, update the status message to "Invalid PIN or Corrupt Vault", and abort the login.
> 
> **5. task: $state Injection & Dispatch**
> - If decryption is successful, you now have the plaintext `private_box_key` and `private_sign_key` in local RAM.
> - Emit a successful login event using `$bus.emit('auth:unlocked', { keys: decryptedKeys, userRecord: record })`. 
> - Update the status text to "Vault unlocked. Entering chat..."

## Phase 2: Backend Pipeline (PocketBase)
Objective: Configure the "dumb pipe" server to handle encrypted routing and zero-knowledge storage.

### track 2.1: Schema Setup

#### task 2.1.1: Configure the `users` collection
- Expand the default PocketBase `users` collection.
- Add text fields for the public Libsodium keys.
- Add a JSON field to store the encrypted Vault holding the private keys.
- Add necessary authentication fallback fields like the KEK derivation salt.

##### Jules prompt
> **Goal:** Configure the PocketBase `users` collection schema to support the End-to-End Encrypted (E2EE) identity model.
> 
> **Instructions:**
> You are configuring the backend schema for `atoll chat` using PocketBase. This task focuses entirely on the database structure for the `users` collection.
> 
> **1. task: Public Key Fields**
> - Add a new field: `public_box_key` (Type: Text). Description: The base64-encoded X25519 public key used by others to encrypt messages for this user.
> - Add a new field: `public_sign_key` (Type: Text). Description: The base64-encoded Ed25519 public key used to cryptographically verify this user's identity.
> 
> **2. task: The Zero-Knowledge Vault**
> - Add a new field: `encrypted_master_keys` (Type: JSON). Description: Stores the `{ vault_ciphertext, vault_nonce }` payload. The server cannot read the contents of this JSON.
> 
> **3. task: Key Derivation & Auth Fields**
> - Add a new field: `pin_salt` (Type: Text). Description: The random salt used in combination with a 6-digit PIN and Argon2id to derive the Key Encryption Key (KEK).
> - Add a new field: `passkey_credential_id` (Type: Text). Description: Stores the WebAuthn ID to prompt the correct biometric credential for the PRF extension (optional for this initial setup, but good for future-proofing).
> 
> **4. task: Constraints & Indexes**
> - Ensure the built-in `username` field is set to **Unique** to prevent account collisions, as this is how users will search for each other to initiate chats.

#### task 2.1.2: Configure `rooms` and `room_members` collections
- Create the `rooms` collection to manage conversation existence and metadata.
- Create the `room_members` collection to manage access control and securely distribute the encrypted symmetric Room Keys.
- Implement the critical `wrapped_by` relation to prevent key spoofing and O(N) iteration vulnerabilities.

##### Jules prompt
> **Goal:** Configure the PocketBase schema for `rooms` and `room_members` to securely handle End-to-End Encrypted group and 1-on-1 chats.
> 
> **Instructions:**
> You are configuring the backend schema for `atoll chat` using PocketBase. Focus on the collections that manage chat rooms and access control.
> 
> **1. task: The `rooms` Collection**
> - Create a new collection named `rooms`.
> - Add a new field: `is_group` (Type: Boolean). Description: True if it's a multi-user group chat, false for a standard 1-to-1 conversation.
> - Add a new field: `encrypted_metadata` (Type: Text). Description: Stores the symmetrically encrypted JSON containing the group's name and avatar URL. (Can be left blank for 1-to-1 chats).
> 
> **2. task: The `room_members` Collection (Key Distribution)**
> - Create a new collection named `room_members`.
> - Add a new field: `room_id` (Type: Relation, Target collection: `rooms`, Max select: 1).
> - Add a new field: `user_id` (Type: Relation, Target collection: `users`, Max select: 1). Description: The member receiving the access key.
> - Add a new field: `wrapped_by` (Type: Relation, Target collection: `users`, Max select: 1). **CRITICAL SECURITY FIELD:** Description: The ID of the user who invited this member and wrapped the key. The client uses this to know whose public key to verify against.
> - Add a new field: `encrypted_room_key` (Type: Text). Description: The base64-encoded 32-byte shared Room Key, encrypted specifically for the `user_id` using Libsodium.
> - Add a new field: `role` (Type: Select, Choices: `admin`, `member`, `kicked`).
> 
> **3. task: Database Indexes**
> - In the `room_members` collection settings, create a unique compound database index on `room_id` and `user_id` to prevent a user from having duplicate membership records in the same room.

### track 2.2: Security & Rules

#### task 2.2.1: Secure the `users` collection and implement rate-limiting
- Configure PocketBase API Rules for the `users` collection.
- Implement a custom PocketBase JavaScript hook (`pb_hooks`) to rate-limit the fetching of `pin_salt` and `encrypted_master_keys` to prevent offline brute-force attacks.
- Ensure public keys (`public_box_key`, `public_sign_key`) remain publicly searchable for initiating chats.

##### Jules prompt
> **Goal:** Secure the `users` collection by configuring API rules and writing a `pb_hooks` script to rate-limit access to the cryptographic vault and salt.
> 
> **Instructions:**
> You are configuring the backend security rules for `atoll chat` using PocketBase's API Rules and its internal JavaScript engine (`pb_hooks`).
> 
> **1. task: Collection API Rules (`users`)**
> - Instruct the user to open the PocketBase Admin UI for the `users` collection.
> - **List/Search Rule:** Set to `""` (leave empty so any authenticated user can search for usernames to start chats).
> - **View Rule:** Set to `""` (allow any authenticated user to view profiles to get public keys).
> - **Create Rule:** Set to `""` (allow anyone to register).
> - **Update/Delete Rule:** Set to `id = @request.auth.id` (users can only modify their own account).
> 
> **2. task: Create the `pb_hooks` Security Script**
> - Create a file at `pb_hooks/security.pb.js` in the PocketBase directory.
> - Use the `onRecordViewRequest('users', (e) => { ... })` and `onRecordsListRequest('users', (e) => { ... })` hooks.
> - **Logic:** Check if the user making the request (`e.httpContext.get('authRecord')`) is the same as the user record being requested.
> - If they are NOT the same user, write logic to dynamically delete/hide the `encrypted_master_keys` and `pin_salt` fields from the returned JSON response. This ensures public keys are visible, but the Vault remains strictly private.
> 
> **3. task: Implement Rate Limiting for the Vault**
> - Since the `users` Auth endpoint (or fetching one's own record) exposes the `pin_salt` needed to attempt a login, we must prevent brute-force requests.
> - Inside the `pb_hooks/security.pb.js`, implement a basic rate limiter using the `$app.cache()` or a custom in-memory map.
> - **Logic:** When a request is made to fetch a user's own `pin_salt` (e.g., during the pre-login phase via a custom route or standard fetch), check the IP address (`e.httpContext.realIP()`).
> - If the IP has made more than 5 requests in the last minute, throw a `new rest.ApiError(429, "Too many attempts.")`.

### track 2.1: Schema Setup

#### task 2.1.3: Configure the `messages` collection
- Create the `messages` collection to act as the real-time End-to-End Encrypted data bus.
- Add relational fields linking the message to a specific room and sender.
- Add the `epoch_id` field to support historical key ratcheting.
- Add the `previous_msg_uuid` to enforce cryptographic causal ordering.
- Add the `payload` and `signature` fields to store the authenticated ciphertext.

##### Jules prompt
> **Goal:** Configure the PocketBase schema for the `messages` collection, which acts as the core real-time routing bus for all encrypted data.
> 
> **Instructions:**
> You are configuring the backend schema for `atoll chat` using PocketBase. The server must remain completely blind to the contents of this collection.
> 
> **1. task: Relational Routing Fields**
> - Create a new collection named `messages`.
> - Add a new field: `room_id` (Type: Relation, Target collection: `rooms`, Max select: 1). Description: The chat room this message belongs to.
> - Add a new field: `sender_id` (Type: Relation, Target collection: `users`, Max select: 1). Description: The user who sent the message.
> 
> **2. task: Cryptographic & Ordering Fields**
> - Add a new field: `epoch_id` (Type: Number). Description: The Key Generation/Epoch ID. This tells the receiving client's Web Worker exactly which historical Room Key from their IndexedDB to use for decryption.
> - Add a new field: `previous_msg_uuid` (Type: Text). Description: The database ID of the message that immediately preceded this one. This creates a cryptographic chain that the client verifies to defeat server-side "time travel" or message reordering attacks.
> 
> **3. task: The Payload Fields**
> - Add a new field: `payload` (Type: Text). Description: The base64-encoded, symmetrically encrypted JSON string. The server cannot read this. (Once decrypted on the client, it will reveal the `type` (text, media, call_offer) and the actual content).
> - Add a new field: `signature` (Type: Text). Description: The Ed25519 signature of the `payload`, signed by the sender's `private_sign_key`. The receiving Web Worker will verify this against the sender's `public_sign_key` to prevent the server from injecting fake messages.
> 
> **4. task: Indexes**
> - Create a database index on `room_id` and `created` (descending) to optimize the initial fetch of chat history when a user opens a room.

## phase 3: The Decryption Pipeline & Local Cache
Objective: Build the local offline-first database and the background decryption worker.

### track 3.1: IndexedDB Architecture

#### task 3.1.1 & 3.1.2: Implement the `$localDbPlugin` and Define Schemas
- Install `dexie` to interact with IndexedDB elegantly.
- Create a Coralite plugin to instantiate a single local database connection.
- Define the client-side schemas for `local_rooms`, `local_messages`, and `local_assets` to support complex relational querying without hitting the server.
- Request persistent storage from the browser to prevent eviction.

##### Jules prompt
> **Goal:** Build the `$localDbPlugin` using Dexie.js to serve as the zero-knowledge local cache and define the indexing schemas.
> 
> **Instructions:**
> You are building the local database plugin for `atoll chat` using the Coralite framework. Because the PocketBase server holds only encrypted blobs, this local IndexedDB is the *only* place where plaintext metadata is queried.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `definePlugin` from `coralite`.
> 2. The Dexie database instance must be created ONCE in the global closure of the plugin.
> 3. Inject the `db` instance into the `client.context` so components can access it natively.
> 
> **1. task: Dependency**
> - Instruct the user to install Dexie: `pnpm add dexie`.
> 
> **2. task: Plugin Initialization & Persistence (`src/plugins/$localDbPlugin.js`)**
> - Write the plugin code using `definePlugin`. Name it `local-db`.
> - Import `Dexie` from `dexie`.
> - In the global closure, declare `const db = new Dexie('AtollChatDB');`.
> - Add an asynchronous initialization block that calls `navigator.storage?.persist()` to request persistent storage from the browser (preventing iOS/Chrome from deleting the keys when storage is low).
> 
> **3. task: Schema Definition**
> - Define the database schema using `db.version(1).stores({ ... })`. 
> - **CRITICAL INDEXING RULES:** In Dexie, you only define the primary key and the fields you want to *search* or *sort* by. Do not define every property of the object.
> - **`local_rooms`:** `"id, is_group"` (The `key_history` array will be stored here, but doesn't need to be indexed).
> - **`local_messages`:** `"id, room_id, [room_id+created_at], type"` (We need to query all messages for a `room_id`, sort them by time/causal chain, and occasionally filter by `type` like media).
> - **`local_assets`:** `"id, room_id, mime_type, created_at"` (We must index `mime_type` so the UI can instantly filter the Global Media Archive by 'image/', 'video/', or 'audio/').
> 
> **4. task: Context Injection**
> - Return the instance injector function: `return (instanceContext) => db;` mapped to the `$localDb` key in the `client.context`.
> - Provide the updated `coralite.config.js` registration instruction for this new plugin.

### track 3.2: The Web Worker

#### task 3.2.1: Initialize the Web Worker and Coralite `workerPlugin`
- Create the background Web Worker script (`worker.js`).
- Load the Libsodium WebAssembly (WASM) module inside the worker context to ensure cryptography does not block the main UI thread.
- Create the Coralite `workerPlugin` to spawn the worker globally and inject the communication interface into the component context.

##### Jules prompt
> **Goal:** Build the `workerPlugin` and the standalone `worker.js` script to establish the off-main-thread cryptographic engine.
> 
> **Instructions:**
> You are building the background processing pipeline for `atoll chat`. This requires two distinct files: the worker script itself, and the Coralite plugin to manage it.
> 
> **1. task: The Worker Script (`public/worker.js`)**
> - Create a new file in the `/public` directory so it is served statically.
> - Import the `libsodium-wrappers` library. *(Note: Since this is a standard Web Worker, you may need to use `importScripts` pointing to a CDN or local copy, depending on your build setup. Provide the standard `importScripts('https://cdn.jsdelivr.net/npm/libsodium-wrappers')` for now).*
> - Add an initialization block: `await sodium.ready;`
> - Set up the main listener: `self.onmessage = async (event) => { ... };`
> - Once `sodium.ready` resolves, send a message back to the main thread: `self.postMessage({ type: 'WORKER_READY' });`.
> 
> **2. task: The Coralite Worker Plugin (`src/plugins/workerPlugin.js`)**
> - Use `definePlugin` from `coralite`. Name it `crypto-worker`.
> - In the global closure, instantiate the worker: `const worker = new Worker('/worker.js');`.
> - Listen for the `WORKER_READY` event from the worker.
> - Return the instance injector function mapping to `client.context.$worker`.
> - The injected object should expose a method to send tasks to the worker: `post: (type, payload) => worker.postMessage({ type, payload })`.
> 
> **3. task: Registration**
> - Provide the updated `coralite.config.js` registration instruction for this new plugin.

#### task 3.2.2: Implement the Web Worker Decryption & Verification Loop
- Expand the `worker.js` script to handle the `PROCESS_INCOMING_MESSAGE` event dispatched by the real-time sync plugin.
- Initialize a Web Worker-safe Dexie connection to access the local key cache without blocking the UI.
- Implement the cryptographic pipeline: Verify the Ed25519 sender signature, decrypt the symmetric payload, and extract the causal chain.
- Store the plaintext message locally and notify the main thread to trigger a reactive UI update.

##### Jules prompt
> **Goal:** Build the off-main-thread decryption and signature verification pipeline inside the Web Worker.
> 
> **Instructions:**
> You are expanding the `public/worker.js` script to process hostile-server payloads into verified, plaintext local messages.
> 
> **CRITICAL WORKER DIRECTIVES:**
> 1. Web Workers run in a separate context. You must initialize a secondary `Dexie` instance inside the worker pointing to the exact same `'AtollChatDB'` database name and schema defined in Track 3.1.
> 2. All Libsodium operations must await `sodium.ready`.
> 3. Never trust the payload until the Ed25519 signature is explicitly verified.
> 
> **1. task: Worker Initialization & Caching**
> - At the top of `worker.js`, import standard `dexie` (via `importScripts` or your bundler's worker syntax) and define the schema for `local_rooms` and `local_messages`.
> - Create an in-memory `Map` called `publicKeyCache` to store fetched sender keys and minimize network requests.
> - Inside your `self.onmessage` switch $statement, add a case for `PROCESS_INCOMING_MESSAGE`.
> 
> **2. task: Identity Verification (Ed25519)**
> - Extract the hostile payload from the event: `{ id, room_id, epoch_id, sender_id, ciphertext, nonce, signature, previous_msg_uuid, created }`.
> - **Fetch Sender Key:** Check the `publicKeyCache` for `sender_id`. If missing, perform a standard `fetch()` to the PocketBase REST API (`/api/collections/users/records/${sender_id}`) to retrieve their `public_sign_key`. Cache it.
> - Convert the base64 `signature`, `ciphertext`, and `public_sign_key` to `Uint8Array` buffers using `sodium.from_base64()`.
> - **Verify:** Call `sodium.crypto_sign_verify_detached(signatureBuffer, ciphertextBuffer, publicSignKeyBuffer)`.
> - If this returns `false`, throw a severe error ("Signature forged or invalid"), abort processing, and do not save the message.
> 
> **3. task: Symmetric Decryption (X25519)**
> - If the signature is valid, fetch the Room Key: `const room = await db.local_rooms.get(room_id);`.
> - Find the specific key matching the payload's `epoch_id` from the `room.key_history` array.
> - Convert the base64 `nonce` and the `epochKey` to buffers.
> - **Decrypt:** Call `sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer)`.
> - Convert the decrypted buffer back to a string and parse the JSON (yielding `{ type, content, timestamp }`).
> 
> **4. task: Storage & Causal Chain Resolution**
> - Construct the final plaintext message object. It is crucial to preserve the causal link to prevent message reordering attacks:
>   `{ id, room_id, sender_id, type, content, timestamp, previous_msg_uuid, created_at: created }`
> - Insert this object into the local IndexedDB: `await db.local_messages.put(decryptedMessage)`.
> - **Notify UI:** Post a message back to the main thread: `self.postMessage({ type: 'NEW_LOCAL_DATA', payload: { room_id } })`. This will be caught by the `workerPlugin` and pushed to the `$bus`, instantly updating the `<chat-view>` timeline.

#### task 3.2.3: Implement the Background Room Key Unwrapping (Epoch Updates)
- Expand the `worker.js` script to handle the `PROCESS_NEW_ROOM_KEY` event dispatched by the real-time sync plugin.
- Ensure the worker has access to the current user's unlocked private keys in volatile memory.
- Implement the cryptographic un-wrapping pipeline: Verify the inviter/admin's public key, decrypt the symmetric Room Key using the user's private key, and update the local Dexie database.

##### Jules prompt
> **Goal:** Build the off-main-thread key un-wrapping logic inside the Web Worker to silently handle room invites and Key Epoch changes (forward secrecy).
> 
> **Instructions:**
> You are continuing to expand the `public/worker.js` script for `atoll chat`. This task handles the receipt of new symmetric room keys when the user is invited to a room or when a user is kicked, triggering a new Key Epoch.
> 
> **CRITICAL WORKER DIRECTIVES:**
> 1. You must maintain a volatile, in-memory variable inside the worker (e.g., `let currentUserKeys = null;`) that holds the plaintext private keys. Add a `INIT_KEYS` switch case so the main thread can pass these in upon login.
> 2. **NEVER** save the `currentUserKeys` to the IndexedDB. They must live entirely in the worker's RAM.
> 3. You must strictly verify the `wrapped_by` field to prevent malicious key injection.
> 
> **1. task: Key Injection (Worker Setup)**
> - Add a new case to your `self.onmessage` switch: `case 'INIT_KEYS':`.
> - Store `payload.private_box_key` in a module-scoped variable `currentUserKeys`.
> - (Remind the user to update their `<auth-login>` or `syncPlugin` to dispatch this event immediately after unlocking the vault).
> 
> **2. task: Unwrapping Logic (`PROCESS_NEW_ROOM_KEY`)**
> - Add a case for `PROCESS_NEW_ROOM_KEY`. Extract the payload: `{ room_id, wrapped_by, encrypted_room_key, key_nonce }`.
> - **Fetch Inviter's Public Key:** Check the worker's `publicKeyCache` for the `wrapped_by` ID. If missing, fetch from the PocketBase `/api/collections/users/records/${wrapped_by}` endpoint and cache the `public_box_key`.
> - Convert the base64 `encrypted_room_key`, `key_nonce`, the inviter's `public_box_key`, and the `currentUserKeys.private_box_key` into `Uint8Array` buffers.
> - **Decrypt (Unwrap):** Call `sodium.crypto_box_open_easy(encryptedRoomKeyBuffer, nonceBuffer, inviterPublicKeyBuffer, userPrivateKeyBuffer)`.
> - If this fails, it means the key was not meant for this user or was corrupted. Throw an error and abort.
> 
> **3. task: Epoch Management & Local Storage**
> - If decryption succeeds, you now have the raw 32-byte symmetric Room Key.
> - Fetch the room record from the local IndexedDB: `const room = await db.local_rooms.get(room_id);`.
> - If the room doesn't exist locally yet (e.g., a brand new invite), construct a new room object with `key_history: []`.
> - Determine the `epoch_id` (this can simply be `room.key_history.length + 1`, or ideally passed securely in the payload depending on your schema).
> - Push the new base64 encoded key into the array: `room.key_history.push({ epoch_id, key: sodium.to_base64(unwrappedKeyBuffer) })`.
> - Save the updated room back to Dexie: `await db.local_rooms.put(room)`.
> 
> **4. task: UI Notification**
> - Post a message back to the main thread: `self.postMessage({ type: 'NEW_LOCAL_ROOM', payload: { room_id } })`. This ensures the UI updates the `<list-pane>` if a new chat needs to be rendered.

## phase 4: Core Messaging & 3-Column UI
Objective: Build the primary user interface and implement End-to-End Encrypted messaging.

### track 4.1: The Application Shell

#### task 4.1.1: Build `<app-layout>` and the fixed left-hand `<nav-sidebar>`
- Create the master grid container for the strict 3-column layout.
- Implement the global $state switch that controls the application mode (Chats, Music, Pictures, Videos).
- Build the persistent navigation sidebar (Column 1) to dispatch $state changes.

##### Jules prompt
> **Goal:** Build the foundational SPA layout component (`<app-layout>`) and its persistent navigation sidebar (`<nav-sidebar>`) to establish the 3-column architecture.
> 
> **Instructions:**
> You are building the core UI skeleton for `atoll chat` using the Coralite framework. These components orchestrate the main view $state of the application.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite` for all component scripts.
> 2. Ensure CSS provides a strict, non-scrolling full-height layout (`100vh`, `overflow: hidden` on the body/app-layout) to mimic a native app.
> 3. Use the `$statePlugin` (injected as `$state`) to track the `currentAppView`.
> 
> **1. task: The Navigation Sidebar (`src/components/nav-sidebar.html`)**
> - Define the component template. It should be a narrow vertical column.
> - Include four distinct buttons or icon wrappers: "Chats", "Music", "Pictures", and "Videos", plus a "Settings" button at the bottom.
> - In the `script: ({ refs, $state }) => {}` block, attach click listeners to these buttons.
> - When clicked, update the global $state: `$state.currentAppView = 'chats'` (or 'music', etc.).
> - Add a CSS class (e.g., `active`) to the currently selected button by reactively listening to `$state.currentAppView`.
> 
> **2. task: The App Layout Master (`src/components/app-layout.html`)**
> - Define the component template using a CSS Grid or Flexbox layout that strictly defines three columns:
>   - Column 1: Fixed narrow width (e.g., `80px`) for `<nav-sidebar>`.
>   - Column 2: Fixed medium width (e.g., `350px`) for the contextual list. Give this a `ref="columnTwo"`.
>   - Column 3: Fluid width (`flex: 1` or `1fr`) for the main detail view. Give this a `ref="columnThree"`.
> - Inside Column 1 of the template, explicitly place the `<nav-sidebar></nav-sidebar>` tag.
> 
> **3. task: View Routing Logic**
> - In the `script: ({ refs, $state }) => {}` block of `<app-layout>`, set up a reactive observer or getter on `$state.currentAppView`.
> - (For now) Just write a standard `console.log` or update a basic text node inside `refs('columnTwo')` outputting the current $state (e.g., "Rendering list for: chats"). We will build the actual dynamic list mounting in the next task.

#### task 4.1.2: Build `<list-pane>` (Column 2) and bind it to `$localDbPlugin` queries
- Create the dynamic middle column component that reacts to the navigation $state.
- Implement live Dexie queries using the injected `$localDbPlugin` based on whether the user is viewing Chats or a specific Media archive.
- Render the resulting local database records into clickable list items.

##### Jules prompt
> **Goal:** Build the `<list-pane>` component that dynamically queries the local zero-knowledge database and renders the contextual list for Column 2.
> 
> **Instructions:**
> You are building the contextual navigation column for `atoll chat` using the Coralite framework. This component bridges the global $state and the local Dexie database.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. Ensure smooth reactive updates. When the global `$state` changes, the local database query must re-run, and the DOM must update.
> 
> **1. task: Component Setup (`src/components/list-pane.html`)**
> - Define the HTML template. Create a wrapper `div` with `ref="listContainer"` to hold the dynamic list items.
> - Include a `<header>` element with a dynamic title `ref="paneTitle"` (e.g., "Chats", "Pictures").
> - In the `script: ({ refs, $state, $localDb, $bus }) => {}` block, set up a reactive observer or effect watching `$state.currentAppView`.
> 
> **2. task: The Dexie Query Switcher**
> - Inside your reactive effect, write a `switch` or `if/else` block based on `$state.currentAppView`.
> - **If 'chats':** >   - Update `refs('paneTitle')` to "Chats".
>   - Query: `await $localDb.local_rooms.toArray()` (For a production app, this would be an `orderBy` or a liveQuery, but a standard fetch is fine for this foundation).
> - **If 'music':**
>   - Update `refs('paneTitle')` to "Music".
>   - Query: `await $localDb.local_assets.filter(asset => asset.mime_type.startsWith('audio/')).toArray()`.
> - **If 'pictures':**
>   - Update `refs('paneTitle')` to "Pictures".
>   - Query: `await $localDb.local_assets.filter(asset => asset.mime_type.startsWith('image/')).toArray()`.
> - **If 'videos':**
>   - Update `refs('paneTitle')` to "Videos".
>   - Query: `await $localDb.local_assets.filter(asset => asset.mime_type.startsWith('video/')).toArray()`.
> 
> **3. task: Rendering the List**
> - Take the array of results from the query and map over them to create DOM elements.
> - Clear the existing contents of `refs('listContainer')`.
> - For each item, append a basic HTML string or manually construct elements (e.g., `<div class="list-item">...</div>`) displaying the room name or asset metadata.
> - Add a click event listener to each rendered item. When an item is clicked, update the $state to reflect the active selection: `$state.activeSelectionId = item.id`, and `$state.activeSelectionType = $state.currentAppView`.
> 
> **4. task: Reactivity to New Background Messages**
> - Use the injected event bus to listen for new data: `$bus.on('new_local_data', () => { /* re-run the current query */ })`. This ensures the list updates instantly when the Web Worker decrypts a new message or asset in the background.

### track 4.2: Room Management & Key Epochs

#### task 4.2.1: Build `<create-room-modal>` (Searching users, generating the symmetric Room Key)
- Create a modal overlay component for initiating new conversations.
- Implement a search bar that queries the PocketBase `users` collection by username to find participants.
- Implement the local generation of the 32-byte symmetric Room Key and secure the room's metadata.

##### Jules prompt
> **Goal:** Build the `<create-room-modal>` component to handle user search, participant selection, and the initial symmetric Room Key generation.
> 
> **Instructions:**
> You are building the room creation UI for `atoll chat` using the Coralite framework. This component allows users to find friends and initiate the End-to-End Encrypted room setup.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. Maintain an internal component $state to track the `searchQuery`, `searchResults`, and `selectedParticipants`.
> 
> **1. task: Template Construction**
> - Define the HTML template as an absolute positioned modal overlay (`<div class="modal-backdrop">...</div>`).
> - Include an input for the `roomName` (optional for 1-on-1, required for groups).
> - Include a search input to find users by `username`. Give it a `ref="searchInput"`.
> - Include a container `ref="searchResults"` to display queried users.
> - Include a container `ref="selectedUsers"` to display "pills" or chips of users already added to the draft room.
> - Include a "Create Room" button.
> 
> **2. task: Component Setup & User Search**
> - In the `script: ({ refs, pb }) => {}` block, attach an `input` event listener to the search input.
> - **Debounce** the input slightly, then query PocketBase: `await pb.collection('users').getList(1, 5, { filter: \`username ~ "\${query}"\` })`.
> - Render the resulting users. When a user is clicked, add their full record (including their `id` and `public_box_key`) to a local `selectedParticipants` array and clear the search bar.
> 
> **3. task: Key Generation & Metadata Encryption**
> - Attach a click listener to the "Create Room" button.
> - Dynamically import the `libsodium-wrappers` module and await `sodium.ready`.
> - **Generate the Room Key:** `const roomKey = sodium.randombytes_buf(32);`
> - **Encrypt Metadata:** Create a JSON object `{ name: roomName, avatar: '' }`. Stringify it.
> - Generate a 24-byte nonce. Symmetrically encrypt this JSON using `sodium.crypto_secretbox_easy` with the new `roomKey`.
> - Store the resulting `{ encrypted_metadata, metadata_nonce }` base64 strings in a variable. 
> - *(Note: Do not send to PocketBase yet. Stop here. We will handle the Key Wrapping and distribution in the next task).*

#### task 4.2.2: Implement the "Key Wrapping" distribution logic
- Continue the `create-room-modal` submission flow.
- Implement the "Sender Keys" model by taking the raw symmetric Room Key and individually encrypting (wrapping) it for every participant using their public Libsodium key.
- Batch upload the encrypted room metadata and the wrapped member keys to PocketBase.
- Save the unencrypted Room Key to the local Dexie database for immediate use.

##### Jules prompt
> **Goal:** Implement the cryptographic key-wrapping loop and batch upload to finalize the End-to-End Encrypted room creation.
> 
> **Instructions:**
> You are continuing to build the submit handler inside the `<create-room-modal>` Coralite component. At this point, you have already generated the 32-byte `roomKey` and the `encrypted_metadata`.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Keep all cryptographic operations locally within the `script` setup block before hitting the network.
> 2. Assume the current user's unencrypted private keys and profile data are available via the injected `$state` plugin (e.g., `$state.currentUser.private_box_key`).
> 
> **1. task: Prepare the Participants Array**
> - Ensure the `selectedParticipants` array includes the creator (the current user) as well. The creator must also get a wrapped copy of the key stored on the server so they can recover the chat if they log in from a new device.
> 
> **2. task: The Key Wrapping Loop**
> - Initialize an empty array `wrappedMemberRecords = []`.
> - Iterate over the `selectedParticipants` array.
> - For each participant, convert their base64 `public_box_key` back to a `Uint8Array`.
> - Generate a random 24-byte nonce using `sodium.randombytes_buf`.
> - Encrypt the `roomKey` buffer using `sodium.crypto_box_easy(roomKey, nonce, participantPublicKeyBuffer, currentUserPrivateKeyBuffer)`.
> - Push an object into `wrappedMemberRecords` containing:
>   - `user_id`: participant.id
>   - `wrapped_by`: $state.currentUser.id
>   - `encrypted_room_key`: sodium.to_base64(encryptedKey)
>   - `key_nonce`: sodium.to_base64(nonce)
>   - `role`: (Assign 'admin' to the creator, 'member' to others).
> 
> **3. task: The Batch Server Transaction**
> - Create the `rooms` record first: 
>   `const newRoom = await pb.collection('rooms').create({ is_group: true, encrypted_metadata: metadataPayload })`.
> - Iterate through `wrappedMemberRecords`, attaching `room_id: newRoom.id` to each.
> - Send a `create` request to the `room_members` collection for each participant using `Promise.all()`.
> 
> **4. task: Update Local Cache & Cleanup**
> - Save the plaintext `roomKey` to the local database to avoid needing to download and unwrap it immediately: 
>   `await $localDb.local_rooms.put({ id: newRoom.id, is_group: true, key_history: [{ epoch_id: 1, key: sodium.to_base64(roomKey) }] })`.
> - Use `$bus.emit('modal:close')` to hide the modal.
> - Update the global $state to navigate to the newly created chat: `$state.activeSelectionId = newRoom.id`.

#### task 4.2.3: Implement the "Kick User" flow (Key Epochs)
- Handle the removal of a participant from a group chat.
- Generate a new 32-byte Room Key to establish a new Key Epoch (Forward Secrecy).
- Wrap the new key exclusively for the surviving members.
- Update the local Dexie database to retain the historical keys for reading past messages while using the new key for future messages.

##### Jules prompt
> **Goal:** Build the cryptographic flow to remove a user from a group and establish a new Key Epoch to guarantee forward secrecy.
> 
> **Instructions:**
> You are building the "Kick User" action for `atoll chat`. This logic will likely reside inside the `<room-details-sidebar>` component when an admin clicks "Remove" next to a member's name.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. Ensure the local Dexie database (`$localDb`) correctly appends to the `key_history` array rather than overwriting it.
> 
> **1. task: Identify Survivors & Generate New Key**
> - When the "Remove User" action is triggered, determine the `kickedUserId` and the `roomId`.
> - Query PocketBase for all active members of the room: `await pb.collection('room_members').getFullList({ filter: \`room_id="\${roomId}"\` })`.
> - Filter out the `kickedUserId` to create a `survivors` array.
> - Import `libsodium-wrappers`. Generate a new 32-byte symmetric key: `const newEpochKey = sodium.randombytes_buf(32);`.
> 
> **2. task: Wrap the New Key for Survivors**
> - Loop through the `survivors` array.
> - Fetch their `public_box_key` from the `users` collection (or use cached data if available).
> - Generate a new 24-byte nonce.
> - Wrap the `newEpochKey` using `sodium.crypto_box_easy` for each survivor.
> - Prepare a batch of new `room_members` records for the server. Set the `role` to 'member' (or 'admin'), and importantly, increment an internal epoch tracker or just replace their existing key records.
> 
> **3. task: The Server Transaction**
> - Delete the `room_members` record of the kicked user from PocketBase: `await pb.collection('room_members').delete(kickedMemberRecordId)`.
> - (Optional but recommended): For existing survivors, you can either update their existing `room_members` record with the new `encrypted_room_key`, or handle epoch tracking natively on the server schema. For this MVP, simply update their existing records with the new wrapped key.
> - Send a system message to the `messages` collection (e.g., `{ type: 'system', content: 'Bob was removed' }`). **CRITICAL:** Encrypt this message using the *newEpochKey* and set `epoch_id: 2` in the payload.
> 
> **4. task: Update the Local Cache (Key History)**
> - Fetch the current room from local Dexie: `const room = await $localDb.local_rooms.get(roomId);`.
> - Determine the next epoch ID: `const nextEpochId = room.key_history.length + 1;`.
> - Push the new plaintext key to the array: `room.key_history.push({ epoch_id: nextEpochId, key: sodium.to_base64(newEpochKey) });`.
> - Save it back: `await $localDb.local_rooms.put(room);`.
> - The local client is now ready to decrypt future messages with the new key while retaining the old key for history.

### track 4.3: The Active Chat

#### task 4.3.1: Build `<chat-view>` (Column 3) and `<message-timeline>`
- Create the primary interface for active conversations to be mounted in Column 3.
- Build the message timeline to securely fetch decrypted payloads from the local IndexedDB.
- Implement reactive DOM updates and auto-scrolling when new messages arrive.
- Differentiate styling between "sent" and "received" message bubbles.

##### Jules prompt
> **Goal:** Build the `<chat-view>` and `<message-timeline>` Coralite components to render the decrypted history of the currently active room, utilizing Bootstrap for layout and styling.
> 
> **Instructions:**
> You are building the main conversation view for `atoll chat` using the Coralite framework. This interface only reads plaintext from the local database; it never queries PocketBase directly for message contents.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`. Never use vanilla Web Component boilerplate.
> 2. Ensure reactivity: when the mutable `$state.activeSelectionId` changes, the script must instantly re-query the local database and update the timeline.
> 3. Use standard Bootstrap 5 classes for all layout and styling (no inline CSS unless strictly necessary).
> 
> **1. task: The Chat View Wrapper (`src/components/chat-view.html`)**
> - Define the HTML `<template id="chat-view">` utilizing Bootstrap flex utility classes to create a full-height column: `<div class="d-flex flex-column h-100">`.
> - Create a `<header>` element (`ref="chatHeader"`) with classes like `d-flex align-items-center p-3 border-bottom`. Include placeholders for the active Room Name (using `{{ roomName }}`), an Avatar, and "Audio Call" / "Video Call" icon buttons.
> - Include the timeline container: `<div ref="timelineContainer" class="flex-grow-1 overflow-auto p-3 d-flex flex-column"></div>` to house the message bubbles.
> - Include an un-implemented `<chat-input></chat-input>` component at the bottom, wrapped in a `p-3 border-top` container.
> 
> **2. task: Timeline Data Querying**
> - In your `script: ({ $state, signal, refs, $localDb, $bus }) => { ... }` block, set up a reactive observer/watcher for `$state.activeSelectionId`.
> - When `activeSelectionId` is present and `$state.activeSelectionType === 'chats'`, query the room metadata from `$localDb.local_rooms` to populate the header (e.g., updating `$state.roomName`).
> - Next, query the message history: `await $localDb.local_messages.where('room_id').equals(state.activeSelectionId).sortBy('created_at')`. *(Note: For production, we will use the `previous_msg_uuid` causal chain, but sorting by time is acceptable for this foundational step).*
> 
> **3. task: Rendering the Timeline (Imperative DOM)**
> - Clear the container: `refs('timelineContainer').innerHTML = ''`.
> - Iterate over the queried messages. 
> - For each message, dynamically construct DOM nodes using standard `document.createElement('div')`. Do **not** use `innerHTML` to stamp out string literals for security and Coralite compatibility.
> - **Alignment Logic (Bootstrap):** >   - If `message.sender_id === $state.currentUser.id` (Sent): Apply classes `align-self-end bg-primary text-white rounded p-2 mb-2 max-w-75`.
>   - Otherwise (Received): Apply classes `align-self-start bg-light text-dark rounded p-2 mb-2 max-w-75`.
> - Set the `textContent` of the bubble to `message.content` and append it to `refs('timelineContainer')`.
> 
> **4. task: Auto-Scroll & Real-Time Updates**
> - After the loop finishes rendering, write a helper to automatically scroll to the newest message: `refs('timelineContainer').scrollTop = refs('timelineContainer').scrollHeight`.
> - Use the injected event bus to listen for new background messages: `const onNewData = (payload) => { ... }`. Register it with `$bus.on('new_local_data', onNewData)`.
> - If `payload.room_id === $state.activeSelectionId`, re-run the local database query, clear the container, re-render the timeline, and trigger the auto-scroll helper so the user sees the newest message.
> - **CRITICAL CLEANUP:** Bind the bus listener removal to the Coralite component lifecycle to prevent memory leaks: `signal.addEventListener('abort', () => $bus.off('new_local_data', onNewData))`.


#### task 4.3.2: Build `<chat-input>`, capturing text, encrypting the inner JSON payload, and uploading to PocketBase
- Create the text input interface for the active chat view.
- Retrieve the current Key Epoch for the active room from the local IndexedDB.
- Establish the cryptographic causal chain by referencing the `previous_msg_uuid`.
- Construct the JSON message payload, symmetrically encrypt it, cryptographically sign it to prevent forgery, and push to the server.

##### Jules prompt
> **Goal:** Build the `<chat-input>` Coralite component—utilizing Bootstrap for a clean, responsive UI—to handle the complex End-to-End Encryption payload construction and server dispatch.
> 
> **Instructions:**
> You are building the message composition UI for `atoll chat`. This component sits at the bottom of the `<chat-view>` and acts as the entry point for data entering the hostile server environment.
> 
> **CRITICAL CORALITE & UI DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. Ensure the template is wrapped in a `<template id="chat-input">` tag.
> 3. Use standard Bootstrap 5 classes (e.g., `input-group`, `form-control`) for the layout and styling.
> 4. Assume all required keys (User's private keys, Room's symmetric keys) are available in the local cache or `$state`. DO NOT fetch keys from PocketBase during the send loop.
> 
> **1. task: Template Construction (`<template id="chat-input">`)**
> - Define the declarative HTML structure. Create a wrapper `div` with spacing utility classes (e.g., `p-3 border-top`).
> - Use a Bootstrap `input-group` to align the controls horizontally.
> - Include an attachment button (`ref="attachButton"`) styled as a `btn btn-outline-secondary` (use an icon like a paperclip).
> - Include a textarea (`ref="messageInput"`) styled with `form-control` (ensure it allows multi-line text but doesn't break the layout).
> - Include a submit button (`ref="sendButton"`) styled as `btn btn-primary`.
> 
> **2. task: Component Setup & Data Retrieval (`script` block)**
> - In the `script: ({ refs, $state, pb, $localDb }) => { ... }` block, attach a `click` event listener to `refs('sendButton')`.
> - When clicked, read the text from `refs('messageInput').value`. If empty or only whitespace, return early.
> - **Fetch Room Key:** Query `$localDb.local_rooms` for `$state.activeSelectionId`. Extract the *latest* key from the `key_history` array. Record its `epoch_id`.
> - **Fetch Causal Link:** Query `$localDb.local_messages` for the most recent message in this room. Extract its `id` to use as the `previous_msg_uuid` (or null if it's the first message).
> 
> **3. task: Encryption Pipeline**
> - Dynamically import `libsodium-wrappers` inside the script block using standard `await import`  and await `sodium.ready`.
> - Construct the plaintext JSON: `const plaintextObj = { type: 'text', content: messageText, timestamp: Date.now() };`. Stringify it.
> - Generate a 24-byte nonce using `sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)`.
> - Symmetrically encrypt the string using `sodium.crypto_secretbox_easy` with the extracted Room Epoch Key.
> 
> **4. task: Signature Pipeline (Identity Verification)**
> - Take the resulting ciphertext buffer.
> - Fetch the user's `private_sign_key` (Ed25519) from `$state.currentUser.private_sign_key`. Convert the base64 string to a `Uint8Array` buffer.
> - Create a detached signature using `sodium.crypto_sign_detached(ciphertextBuffer, privateSignKeyBuffer)`.
> 
> **5. task: Server Upload**
> - Construct the final hostile-server payload:
>   `{ room_id: $state.activeSelectionId, epoch_id: latestEpochId, ciphertext: sodium.to_base64(ciphertextBuffer), nonce: sodium.to_base64(nonce), signature: sodium.to_base64(signatureBuffer), previous_msg_uuid: previousMsgId }`
> - Send a `create` request to the PocketBase `messages` collection.
> - Clear the `messageInput` value.
> - *(Note: Do not manually update the timeline here. The PocketBase SSE connection will detect the new record, send it to the Web Worker for signature verification/decryption, and the worker will emit an event to automatically render the local echo.)*

## phase 5: Real-Time Sync & Background Decryption
Objective: Establish the Server-Sent Events (SSE) connection and handle off-thread cryptographic decryption and signature verification.

### track 5.1: The Subscription Pipeline

#### task 5.1.1: Build the `syncPlugin` to handle real-time PocketBase events
- Create a Coralite plugin to manage the global SSE connection.
- Subscribe to the `messages` and `room_members` collections to listen for new data.
- Route incoming encrypted payloads directly to the Web Worker to prevent UI thread blocking.

##### Jules prompt
> **Goal:** Build the `syncPlugin` to establish real-time subscriptions and act as the data router between the PocketBase server and the Web Worker.
> 
> **Instructions:**
> You are building the real-time synchronization layer for `atoll chat` using the Coralite framework.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `definePlugin` from `coralite`. Name it `realtime-sync`.
> 2. Ensure subscriptions are initialized only once the user is authenticated and the vault is unlocked.
> 
> **1. task: Plugin Setup & Dependencies**
> - In the global closure, declare a variable to track the subscription status (e.g., `let isSubscribed = false;`).
> - Return the instance injector function `(instanceContext) => { ... }`.
> - Destructure `pb` (PocketBase client) and `$worker` (from `workerPlugin`) from `instanceContext`.
> 
> **2. task: The Subscription Logic**
> - Create a function `startSubscriptions()`. Check if `isSubscribed` is true; if so, return early to prevent duplicate SSE connections.
> - Subscribe to the messages collection: `await pb.collection('messages').subscribe('*', (e) => { ... })`.
> - Subscribe to the room members collection: `await pb.collection('room_members').subscribe('*', (e) => { ... })`.
> - Set `isSubscribed = true` upon successful connection.
> 
> **3. task: Routing to the Worker**
> - Inside the `messages` subscription callback:
>   - If `e.action === 'create'`, intercept the incoming encrypted payload.
>   - **CRITICAL:** Do NOT attempt to decrypt or verify the signature on the main thread.
>   - Dispatch it to the background worker: `$worker.post('PROCESS_INCOMING_MESSAGE', e.record)`.
> - Inside the `room_members` subscription callback:
>   - If `e.action === 'create'` or `e.action === 'update'`, dispatch it to the worker: `$worker.post('PROCESS_NEW_ROOM_KEY', e.record)`.
> 
> **4. task: Context Injection & Registration**
> - Return an object exposing the `startSubscriptions` method so components can trigger the SSE connection.
> - Map this object to `client.context.$sync`.
> - Provide a brief instruction to update the `<auth-login>` and `<auth-register>` components to call `$sync.startSubscriptions()` immediately after emitting their success events.
> - Provide the updated `coralite.config.js` registration instruction for this new plugin.

#### task 5.1.2: Implement the "Catch-Up" Sync Loop (Offline-First Recovery)
- Expand the `syncPlugin` to handle the historical gap between the local database and the server.
- Implement a routine that checks the timestamp of the newest local message.
- Query PocketBase for any missed messages or room invites that occurred while the user was offline.
- Route this historical backlog through the exact same Web Worker pipeline as the live SSE events.

##### Jules prompt
> **Goal:** Build the historical catch-up routine inside the `syncPlugin` to ensure the offline-first app recovers any messages or room invites missed while disconnected.
> 
> **Instructions:**
> You are expanding the `src/plugins/syncPlugin.js` for `atoll chat`. Real-time Server-Sent Events (SSE) are great, but they only capture data while the app is open. We need a recovery loop that runs right before the subscriptions start.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Keep this logic inside the `syncPlugin` so it shares the injected context (`pb`, `$worker`, `$localDb`).
> 2. Ensure the catch-up loop completes (or at least starts processing) before binding the live SSE listeners to prevent race conditions.
> 
> **1. task: Determine the Last Sync Timestamp**
> - Create an async function `performCatchUpSync()`.
> - Query the local Dexie database to find the most recent message: `const latestMsg = await $localDb.local_messages.orderBy('created_at').last()`.
> - Determine the `lastSyncTime`. If `latestMsg` exists, use its `created_at` timestamp (ensure it's formatted to match PocketBase's `YYYY-MM-DD HH:mm:ss.SSSZ` format). If local DB is empty, use a default past date (e.g., `'2000-01-01 00:00:00.000Z'`).
> 
> **2. task: Fetch Missed Messages**
> - Query PocketBase for missed messages: `const missedMessages = await pb.collection('messages').getFullList({ filter: \`created > "\${lastSyncTime}"\`, sort: 'created' })`.
> - Iterate through the `missedMessages` array.
> - Dispatch each record to the worker precisely as you did in the SSE listener: `$worker.post('PROCESS_INCOMING_MESSAGE', record)`.
> 
> **3. task: Fetch Missed Room Invites/Epochs**
> - Query PocketBase for missed room keys (this is critical if the user was invited to a room or kicked while offline).
> - Fetch using a similar filter: `const missedKeys = await pb.collection('room_members').getFullList({ filter: \`updated > "\${lastSyncTime}"\`, sort: 'updated' })`. *(Note: Use 'updated' here in case an existing room epoch was changed).*
> - Iterate and dispatch to the worker: `$worker.post('PROCESS_NEW_ROOM_KEY', record)`.
> 
> **4. task: Orchestration**
> - Update the `startSubscriptions()` method exposed by the plugin.
> - Await `performCatchUpSync()` *before* calling the PocketBase `subscribe()` methods.
> - This guarantees the local causal chain (using `previous_msg_uuid`) remains intact before live messages start arriving.

### track 5.2: Media & Attachments

#### task 5.2.1: Implement the Encrypted File Upload Utility
- Create a dedicated file handling flow within the `<chat-input>` component.
- Generate a unique, single-use symmetric key for every file attachment.
- Symmetrically encrypt the raw file buffer before uploading the ciphertext blob to a PocketBase `media` collection.
- Securely embed the single-use file key and attachment ID inside the standard Room Key-encrypted message payload.

##### Jules prompt
> **Goal:** Expand the `<chat-input>` component and cryptographic utilities to securely encrypt and upload file attachments (images, videos, audio) prior to sending the message.
> 
> **Instructions:**
> You are building the media upload pipeline for `atoll chat`. Because files can be large, we do not encrypt them with the Room Key directly, nor do we store them in the main `messages` table. Instead, we encrypt them with a unique File Key, upload the blob, and send the File Key securely inside the room message.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `refsPlugin` to interact with a hidden `<input type="file">`.
> 2. Ensure the UI provides feedback (e.g., "Encrypting file...", "Uploading...") as file processing can take a moment.
> 
> **1. task: Template Expansion (`src/components/chat-input.html`)**
> - Add a hidden file input to the template: `<input type="file" ref="fileInput" style="display: none;" accept="image/*, video/*, audio/*">`.
> - Attach a click listener to your existing `ref="attachButton"` that triggers `refs('fileInput').click()`.
> 
> **2. task: Cryptographic File Encryption**
> - In your `script` block, add an event listener for the `change` event on `refs('fileInput')`.
> - When a file is selected, read it as an `ArrayBuffer` using `file.arrayBuffer()`. Convert it to a `Uint8Array`.
> - Import `libsodium-wrappers` and await `sodium.ready`.
> - Generate a unique 32-byte key specifically for this file: `const fileKey = sodium.randombytes_buf(32);`.
> - Generate a 24-byte nonce.
> - Encrypt the file buffer: `const encryptedFile = sodium.crypto_secretbox_easy(fileBuffer, nonce, fileKey);`.
> 
> **3. task: Server Upload (The `media` Collection)**
> - Convert the `encryptedFile` buffer to a standard `Blob`.
> - Create a `FormData` object. Append the Blob as a file field (e.g., `formData.append('file', blob, 'encrypted.bin')`).
> - Send a `create` request to a new PocketBase `media` collection: `const mediaRecord = await pb.collection('media').create(formData)`.
> 
> **4. task: Payload Construction**
> - Now that the file is uploaded, you must construct the plaintext message JSON to be sent to the room.
> - Structure: `{ type: 'media', mime_type: file.type, media_id: mediaRecord.id, file_key: sodium.to_base64(fileKey), file_nonce: sodium.to_base64(nonce), timestamp: Date.now() }`.
> - Pass this JSON string into the exact same Room Key encryption and Ed25519 signature pipeline you built in Task 4.3.2.
> - Send the resulting payload to the PocketBase `messages` collection. The file is now securely linked and perfectly zero-knowledge.

### track 5.3: The Global Media Archive

#### task 5.3.1: Build `<picture-list>`, `<video-list>`, and `<music-list>` for Column 2
- Create dedicated Coralite components for each media type to dynamically render inside the `<list-pane>`.
- Query the `local_assets` IndexedDB table using the `mime_type` index to separate media types.
- Render contextual list items (e.g., visual grids for images/videos, standard list rows for audio).
- Wire click events to update the global $state, paving the way for the dedicated media viewers in Column 3.

##### Jules prompt
> **Goal:** Build specialized media list components (`<picture-list>`, `<video-list>`, `<music-list>`) to display contextual file archives in Column 2.
> 
> **Instructions:**
> You are building the specific media navigation components for `atoll chat`. These will replace the generic list-rendering logic we temporarily placed in the `<list-pane>` component during Phase 4.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. Ensure these components are strictly offline-first. They must only read from the injected `$localDb`.
> 
> **1. task: Refactor `<list-pane>` Mounting**
> - Update the `switch` $statement or reactive block in your existing `<list-pane>` component. 
> - Instead of manually constructing DOM nodes for every query, delegate the rendering. Mount or toggle the visibility of `<picture-list>`, `<video-list>`, or `<music-list>` based on `$state.currentAppView`.
> 
> **2. task: Data Querying per Component**
> - Inside the `script: ({ $localDb, $bus }) => {}` block for each respective component, fetch the sorted data:
> - **`<picture-list>`:** `await $localDb.local_assets.where('mime_type').startsWith('image/').reverse().sortBy('created_at')`.
> - **`<video-list>`:** `await $localDb.local_assets.where('mime_type').startsWith('video/').reverse().sortBy('created_at')`.
> - **`<music-list>`:** `await $localDb.local_assets.where('mime_type').startsWith('audio/').reverse().sortBy('created_at')`.
> - *Note: Ensure you set up an event listener on `$bus` to re-run these queries when `NEW_LOCAL_DATA` arrives from the Web Worker.*
> 
> **3. task: Contextual UI Rendering**
> - **Pictures & Videos:** Iterate over the queried arrays and render a CSS Grid (`display: grid; grid-template-columns: 1fr 1fr;`) of thumbnails. Because the actual image/video files are encrypted blobs, rendering the true thumbnail requires an asynchronous decryption pass. For this task, render a stylish placeholder `div` displaying the date, time, and a generic media icon.
> - **Music:** Iterate over the audio array and render a vertical list. Include a play icon, the timestamp, and perform a quick secondary query to `$localDb.local_rooms.get(item.room_id)` to display the name of the chat where the track originated.
> 
> **4. task: $state Dispatch & Selection**
> - Attach a click event listener to every rendered media item.
> - When clicked, update the global $state to notify the rest of the application:
>   `$state.activeSelectionId = item.id;`
>   `$state.activeSelectionType = $state.currentAppView;`
> - This crucial $state change will tell Column 3 to unmount the standard `<chat-view>` and mount the secure media players.

#### task 5.3.2: Build `<image-viewer>` and `<video-player-view>` for Column 3, implementing on-the-fly RAM decryption of the binary streams
- Create the dedicated display components that mount in Column 3 when a media item is selected from the list pane.
- Implement the network request to fetch the encrypted blob from the PocketBase `media` collection.
- Utilize the single-use File Key to decrypt the blob entirely within volatile memory (RAM).
- Generate a local `Blob URL` to render the media without ever writing the unencrypted file to disk.

##### Jules prompt
> **Goal:** Build the `<image-viewer>` and `<video-player-view>` Coralite components to download, securely decrypt in RAM, and display media attachments.
> 
> **Instructions:**
> You are building the secure media players for `atoll chat` to be mounted in Column 3. These components replace the standard `<chat-view>` when a user selects a picture or video from the global archive.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. **MEMORY LEAK PREVENTION:** You must tie the `URL.revokeObjectURL` cleanup function to the component's unmount lifecycle using `instanceContext.signal.addEventListener('abort', ...)` to ensure the browser garbage collects the decrypted blobs when the user navigates away.
> 
> **1. task: Template Construction**
> - **`<image-viewer>` (`src/components/image-viewer.html`):** Create a flex-centered container. Include a loading spinner `div` (`ref="loader"`) and an `<img>` tag (`ref="mediaDisplay"`, initially hidden or empty).
> - **`<video-player-view>` (`src/components/video-player-view.html`):** Similar layout, but use a `<video controls autoplay>` tag (`ref="mediaDisplay"`).
> 
> **2. task: Data Retrieval & The Network Fetch**
> - In the `script: ({ refs, $state, pb, $localDb }, instanceContext) => {}` block, set up a reactive effect watching `$state.activeSelectionId`.
> - When triggered, show the `loader`.
> - Query the local database for the necessary keys: `const asset = await $localDb.local_assets.get(state.activeSelectionId)`.
> - Fetch the encrypted binary blob from PocketBase using the `asset.media_id` (e.g., via `pb.getFileUrl()` combined with a standard `fetch()` request that returns an `.arrayBuffer()`).
> 
> **3. task: On-the-Fly RAM Decryption**
> - Convert the fetched ArrayBuffer to a `Uint8Array`.
> - Dynamically import `libsodium-wrappers` and await `sodium.ready`.
> - Convert the `asset.file_key` and `asset.file_nonce` from base64 strings back to `Uint8Array` buffers.
> - **Decrypt:** `const decryptedFileBuffer = sodium.crypto_secretbox_open_easy(encryptedFileBuffer, nonceBuffer, fileKeyBuffer)`.
> - *Error Handling:* Wrap this in a `try/catch`. If decryption fails, update the UI to show "Media Corrupted or Key Invalid" and hide the loader.
> 
> **4. task: Blob URL Generation & Cleanup**
> - Convert the `decryptedFileBuffer` into a browser Blob: `const mediaBlob = new Blob([decryptedFileBuffer], { type: asset.mime_type })`.
> - Generate the local memory URL: `const objectUrl = URL.createObjectURL(mediaBlob)`.
> - Assign the URL to the DOM element: `refs('mediaDisplay').src = objectUrl`.
> - Hide the `loader` and reveal the `mediaDisplay`.
> - **CRITICAL CLEANUP:** Attach the abort listener to revoke the URL when the user switches views and the component unmounts:
>   `instanceContext.signal.addEventListener('abort', () => { URL.revokeObjectURL(objectUrl); });`

## phase 6: Peer-to-Peer Calling & WebRTC
Objective: Establish secure audio/video channels using the existing End-to-End Encrypted pipeline for zero-knowledge signaling.

### track 6.1: Zero-Knowledge Signaling

#### task 6.1.1: Build the `webrtcPlugin` and define the signaling protocol
- Create a Coralite plugin to manage `RTCPeerConnection` lifecycles.
- Define custom message types (`call_offer`, `call_answer`, `ice_candidate`) to be sent through the existing PocketBase `messages` table.
- Intercept these specific signaling messages in the Web Worker so they bypass the standard chat UI and are routed directly to the WebRTC manager.

##### Jules prompt
> **Goal:** Build the `webrtcPlugin` to orchestrate Peer-to-Peer (P2P) connections, using your previously established E2EE message pipeline to exchange SDP and ICE candidates securely.
> 
> **Instructions:**
> You are building the WebRTC signaling foundation for `atoll chat`. Standard WebRTC requires a signaling server. Instead of building a dedicated WebSocket server, we will use our existing, highly secure PocketBase message routing. The server will just see standard encrypted blobs, completely unaware that a call is being negotiated.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `definePlugin` from `coralite`. Name it `webrtc-manager`.
> 2. The plugin must maintain a global registry of active `RTCPeerConnection` instances mapped by `room_id`.
> 
> **1. task: Plugin Initialization & Dependency Injection**
> - In the global closure, create a `Map` to hold active calls: `const activeCalls = new Map();`.
> - Return the instance injector mapping to `client.context.$webrtc`.
> - Ensure the plugin has access to `$bus` (to listen for incoming decrypted signals) and `$localDb` (to fetch room keys for outgoing signals).
> 
> **2. task: The Connection Factory**
> - Expose a method `initiateCall(roomId, mediaStream)`.
> - Inside, instantiate a `new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })`.
> - Add the local `mediaStream` tracks to the connection.
> - Store the connection in `activeCalls.set(roomId, peerConnection)`.
> 
> **3. task: Capturing and Encrypting ICE Candidates**
> - Attach an `onicecandidate` listener to the `peerConnection`.
> - When an ICE candidate is generated (`event.candidate`), construct a JSON payload: 
>   `{ type: 'ice_candidate', candidate: event.candidate, timestamp: Date.now() }`.
> - **CRITICAL:** You must pass this JSON payload through the exact same Libsodium encryption and PocketBase upload pipeline used in `<chat-input>` (Track 4.3.2) to ensure the ICE data is symmetrically encrypted with the Room Key and signed with Ed25519.
> 
> **4. task: Intercepting Incoming Signals via `$bus`**
> - In the plugin's global closure, listen for new local data: `$bus.on('new_local_data', async (payload) => { ... })`.
> - Query the `$localDb.local_messages` for the new message.
> - If `message.type === 'call_offer'`, instantiate a `RTCPeerConnection`, set the remote description, generate an answer, and send the `call_answer` back through the E2EE pipeline.
> - If `message.type === 'call_answer'`, apply the remote description to the existing `peerConnection`.
> - If `message.type === 'ice_candidate'`, apply the candidate using `peerConnection.addIceCandidate()`.
> - If the message type is standard (`text`, `media`), ignore it (the `<chat-view>` timeline will handle it).

#### task 6.1.2: Hook up a free STUN server to generate ICE candidates
- Expand the `webrtcPlugin`'s connection factory to include a robust configuration of public STUN servers for NAT traversal.
- Implement the lifecycle listeners for ICE candidate gathering.
- Ensure the plugin correctly batches or streams the generated candidates to the E2EE signaling pipeline.

##### Jules prompt
> **Goal:** Configure the WebRTC plugin with public STUN servers to successfully traverse NATs and securely capture the resulting ICE candidates for peer signaling.
> 
> **Instructions:**
> You are refining the `src/plugins/webrtcPlugin.js` to ensure reliable Peer-to-Peer connectivity outside of local networks. To do this, WebRTC needs to discover the client's public IP using a STUN (Session Traversal Utilities for NAT) server.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Continue working within the `definePlugin` closure of `webrtc-manager`.
> 2. Do not use TURN servers yet; rely strictly on free public STUN servers for this foundational step.
> 
> **1. task: Robust STUN Configuration**
> - Update the `initiateCall` and answer-generation methods where `RTCPeerConnection` is instantiated.
> - Provide a comprehensive `RTCConfiguration` object with multiple reliable public STUN servers to ensure fallback redundancy.
> - Example configuration to implement: 
>   `const rtcConfig = { iceServers: [ { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' } ] };`
> - Pass `rtcConfig` into `new RTCPeerConnection(rtcConfig)`.
> 
> **2. task: The Candidate Gathering Lifecycle**
> - Inside your connection setup, ensure the `peerConnection.onicecandidate` event listener is robust.
> - Add a check: `if (event.candidate) { ... }`. (When the ICE gathering process finishes, the browser fires one final event where `event.candidate` is `null`. You must ignore this null candidate to prevent crashing the signaling pipeline).
> - Set up a listener for `peerConnection.onicegatheringstatechange`. Log the $state (`peerConnection.iceGatheringState`) to the console so we can visually debug the transition from "new" to "gathering" to "complete" during development.
> 
> **3. task: Dispatching to the Secure Pipeline**
> - When a valid `event.candidate` is caught, construct the signaling object: 
>   `const signalPayload = { type: 'ice_candidate', candidate: event.candidate, timestamp: Date.now() };`
> - Call your internal helper method (or emit an event to your `$bus`) that encrypts this JSON using the symmetric Room Key, signs it with the user's Ed25519 key, and uploads it to the PocketBase `messages` collection.
> - This guarantees that the network topology (IP addresses) revealed by the STUN server is completely hidden from the PocketBase server.

### track 6.2: The Call Interface

#### task 6.2.1: Build `<call-overlay>` with `<video-grid>` to display the P2P DTLS-SRTP encrypted streams
- Create a global, full-screen overlay component to handle incoming rings and active call $states.
- Build the `<video-grid>` component to securely bind the raw `MediaStream` objects from the `webrtcPlugin` to HTML5 `<video>` tags.
- Implement the call controls (Mute, Disable Camera, Hang Up) and ensure proper cleanup of hardware resources when the call terminates.

##### Jules prompt
> **Goal:** Build the `<call-overlay>` and `<video-grid>` components to manage the active P2P call lifecycle and render the hardware media streams.
> 
> **Instructions:**
> You are building the visual interface for active WebRTC calls in `atoll chat`. These components will mount over the main application layout when a call is initiated or received.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Use `defineComponent` exported from `coralite`.
> 2. You cannot serialize a `MediaStream` object into $state or the local database. You must request it from the `$webrtc` plugin dynamically and bind it directly to the DOM element using `HTMLMediaElement.srcObject`.
> 
> **1. task: The Call Overlay Wrapper (`src/components/call-overlay.html`)**
> - Define the component template as a full-screen absolute or fixed overlay with a high z-index.
> - Create a UI $state for "Incoming Call" (showing caller's name, "Accept" button, "Reject" button).
> - Create a UI $state for "Active Call" containing the un-implemented `<video-grid></video-grid>` and a control bar (Mute Audio, Disable Video, End Call).
> - In the `script: ({ refs, $state, $bus, $webrtc }) => {}` block, listen for an incoming call event via `$bus` (e.g., `$bus.on('call_incoming', ...)` triggered when Track 6.1 intercepts a `call_offer`). Update local reactive $state to show the "Incoming" UI.
> 
> **2. task: The Video Grid (`src/components/video-grid.html`)**
> - Define the template with two `<video>` elements: `<video ref="remoteVideo" autoplay playsinline></video>` and a smaller Picture-in-Picture `<video ref="localVideo" autoplay playsinline muted></video>`.
> - In the `script` setup, fetch the active local stream from the user's hardware: `const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })`.
> - Assign it immediately to the local video ref: `refs('localVideo').srcObject = localStream`.
> 
> **3. task: Wiring the Streams**
> - Pass the `localStream` to the `$webrtc` plugin to initiate or answer the call: `$webrtc.answerCall(roomId, localStream)`.
> - Set up a listener on the `RTCPeerConnection` (exposed via the plugin or event bus) for the `ontrack` event.
> - When the remote peer's track arrives, assign it to the remote video: 
>   `refs('remoteVideo').srcObject = event.streams[0]`.
> 
> **4. task: Hardware Cleanup & Teardown**
> - Attach click listeners to the control bar buttons in `<call-overlay>`.
> - **Mute/Video toggle:** Iterate over `localStream.getTracks()` and set `track.enabled = false` based on the user's toggle.
> - **End Call:** When the user hangs up, you MUST stop the hardware tracks to turn off the webcam light: `localStream.getTracks().forEach(track => track.stop())`.
> - Call `$webrtc.endCall(roomId)` to close the `RTCPeerConnection` and emit a hang-up message through the secure signaling pipeline.
> - Unmount the overlay or reset its visibility $state.

#### task 6.2.2: Implement call controls (Mute, Camera off, End Call)
- Expand the `<call-overlay>` component to handle active manipulation of the local hardware streams.
- Implement the logic to temporarily disable (mute) audio and video tracks without severing the P2P connection.
- Build the exact teardown sequence required to release hardware locks (turning off the webcam light) and signal the remote peer that the call has ended.

##### Jules prompt
> **Goal:** Build the interactive controls for the active WebRTC call, handling stream manipulation and hardware teardown.
> 
> **Instructions:**
> You are finalizing the `<call-overlay>` component for `atoll chat`. Managing WebRTC requires strict attention to hardware lifecycles; if a user hangs up, their webcam light must instantly turn off, and the remote peer must be notified.
> 
> **CRITICAL CORALITE DIRECTIVES:**
> 1. Continue using the `defineComponent` scope of `<call-overlay>`.
> 2. Maintain a reactive internal $state for `isMuted` and `isVideoOff` to accurately reflect the button UI.
> 
> **1. task: Toggle Media Tracks (Mute / Camera Off)**
> - In your control bar UI, attach click listeners to the "Mute" and "Camera" buttons.
> - Ensure you have access to the `localStream` (this might require storing the stream reference in the component's internal scope when it was created in Task 6.2.1).
> - **Mute Logic:** `localStream.getAudioTracks().forEach(track => { track.enabled = !track.enabled; });`
> - Toggle the `isMuted` $state variable to update the UI (e.g., show a strike-through microphone icon).
> - **Video Logic:** `localStream.getVideoTracks().forEach(track => { track.enabled = !track.enabled; });`
> - Toggle the `isVideoOff` $state variable.
> 
> **2. task: Ending the Call (Local Teardown)**
> - Attach a click listener to the "End Call" button.
> - **Hardware Release:** This is critical. You must stop the tracks to release the hardware: `localStream.getTracks().forEach(track => track.stop());`.
> - Call the WebRTC plugin to close the connection: `$webrtc.endCall(state.activeSelectionId)`.
> - Reset the component's UI $state (e.g., hide the overlay entirely or return to a "Call Ended" summary screen).
> 
> **3. task: The `call_end` Signal (Remote Teardown)**
> - Update the `$webrtc.endCall(roomId)` method inside your `webrtcPlugin.js`.
> - It must fetch the active `RTCPeerConnection` from the map, call `.close()`, and delete it from the map.
> - Construct a hang-up payload: `{ type: 'call_end', timestamp: Date.now() }`.
> - Push this payload through your secure End-to-End Encrypted signaling pipeline (encrypt with Room Key, sign with Ed25519, upload to PocketBase `messages`).
> 
> **4. task: Handling the Remote Hang-up**
> - In your `$bus.on('new_local_data', ...)` listener inside `<call-overlay>` (or the plugin), watch for `message.type === 'call_end'`.
> - If received, trigger the exact same teardown logic: call `.close()` on the peer connection, `.stop()` all tracks on both local and remote streams, and hide the `<call-overlay>`.

### track 6.3: Progressive Web App (PWA) & Offline Reliability

#### task 6.3.1: Implement the Service Worker for static asset caching
- Create the Service Worker script (`sw.js`) to cache the application shell, UI components, and static assets.
- Explicitly cache the Libsodium WebAssembly (WASM) module and background worker scripts so the cryptographic engine can boot without an internet connection.
- Implement the cache lifecycle (Install, Activate) and a network-intercepting Fetch strategy.
- Register the Service Worker in the main application entry point.

##### Jules prompt
> **Goal:** Build the Service Worker to cache the UI shell and cryptographic dependencies, transforming the offline-first database into a fully bootable Progressive Web App even with no network connection.
> 
> **Instructions:**
> You are building the static caching layer for `atoll chat`. We have already secured the offline data via IndexedDB and Web Workers, but if the browser cannot load the HTML, CSS, and Libsodium WASM files, the app will fail to launch on an airplane or in a dead zone.
> 
> **CRITICAL PWA DIRECTIVES:**
> 1. Ensure the Service Worker file (`sw.js`) is placed in the root of your `public` directory so its scope encompasses the entire application.
> 2. You must specifically target the Libsodium libraries in the install cache to ensure the offline cryptographic engine can initialize.
> 
> **1. task: The Install Event & Cache Manifest (`public/sw.js`)**
> - Define a cache name constant at the top of the file: `const CACHE_NAME = 'atoll-chat-v1';`.
> - Define an array of essential URLs to cache: `const ASSETS_TO_CACHE = ['/', '/index.html', '/worker.js', /* add your bundled CSS/JS paths here */]`.
> - **CRITICAL:** Include the exact CDN URLs or local paths used to load `libsodium-wrappers` and its `.wasm` binary in this array.
> - Add the `self.addEventListener('install', (event) => { ... })` lifecycle block.
> - Inside, use `event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)))`.
> 
> **2. task: The Activate Event (Cleanup)**
> - Add the `self.addEventListener('activate', (event) => { ... })` lifecycle block.
> - Implement logic to iterate through all keys in `caches.keys()`.
> - If a cache key does NOT match the current `CACHE_NAME`, delete it using `caches.delete(cacheName)`. This ensures that when we push v2 of the app, users aren't stuck with v1's cached assets.
> 
> **3. task: The Fetch Interceptor (Stale-While-Revalidate or Cache-First)**
> - Add the `self.addEventListener('fetch', (event) => { ... })` block.
> - Exclude API and SSE calls to PocketBase from the Service Worker cache (e.g., `if (event.request.url.includes('/api/')) return;`). The `$localDb` and `syncPlugin` already handle data caching.
> - For static assets, implement a Cache-First or Stale-While-Revalidate strategy: `event.respondWith(caches.match(event.request).then(cachedResponse => cachedResponse || fetch(event.request)))`.
> 
> **4. task: Service Worker Registration**
> - Open your main `index.html` file.
> - Inside a `<script>` tag at the bottom of the body (or in your main client bootstrapper), add the registration block:
>   `if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js'); }); }`

#### task 6.3.2: Configure PocketBase to send generic "New Message" web push events
- Update the PocketBase `users` collection to store Web Push subscription objects.
- Implement the client-side logic to request notification permissions and subscribe to the browser's PushManager using a VAPID public key.
- Create a PocketBase hook (`pb_hooks`) to intercept new messages, look up the room's participants, and trigger a push request.
- Update the Service Worker to listen for the `push` event and display a generic, privacy-preserving notification.

##### Jules prompt
> **Goal:** Implement privacy-preserving Web Push notifications by linking the client's Service Worker to a custom PocketBase hook.
> 
> **Instructions:**
> You are building the background notification pipeline for `atoll chat`. Because this is a strict End-to-End Encrypted application, the server does not know the contents of the message or even the sender's plaintext name. Push notifications must be entirely generic to maintain the zero-knowledge architecture.
> 
> **CRITICAL PWA DIRECTIVES:**
> 1. Never include `ciphertext`, symmetric keys, or specific message metadata in the push payload.
> 2. The push notification must rely solely on standard Web Push protocols (VAPID) to ensure compatibility across iOS, Android, and Desktop browsers.
> 
> **1. task: Database Schema Update**
> - Instruct the user to open the PocketBase Admin UI.
> - Add a new field of type `JSON` to the `users` collection named `push_subscription`.
> - Add a new field of type `JSON` to the `room_members` collection named `notification_preferences` (optional, for muting chats).
> 
> **2. task: Client-Side Subscription Routine**
> - Inside your `syncPlugin.js` (or a dedicated `notificationsPlugin`), write a function `enablePushNotifications()`.
> - Request permission: `const permission = await Notification.requestPermission();`.
> - If granted, get the active Service Worker registration: `const registration = await navigator.serviceWorker.ready;`.
> - Subscribe to the push manager using your application's VAPID public key: 
>   `const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: 'YOUR_VAPID_PUBLIC_KEY' });`
> - Send an `update` request to PocketBase to save this subscription object to the current user's `push_subscription` field.
> 
> **3. task: The PocketBase Trigger (`pb_hooks/push.pb.js`)**
> - Create a new JavaScript hook file in the PocketBase `pb_hooks` directory.
> - Register a hook on message creation: `onRecordAfterCreateRequest('messages', (e) => { ... })`.
> - **Logic:** Extract the `room_id` from `e.record`.
> - Query the `room_members` collection to find all users in this room, excluding the sender.
> - Iterate over the members and fetch their `push_subscription` JSON from the `users` collection.
> - If a subscription exists, use PocketBase's internal `$http.send()` utility to fire a POST request to the subscription's `endpoint` URL. Include the required VAPID JWT in the Authorization header. 
> - *Payload:* Send a strictly generic JSON string: `{"title": "atoll chat", "body": "You have a new secure message."}`.
> 
> **4. task: The Service Worker Listener (`public/sw.js`)**
> - Open your existing Service Worker script.
> - Add the push event listener: `self.addEventListener('push', (event) => { ... })`.
> - Extract the data: `const data = event.data ? event.data.json() : { title: 'atoll chat', body: 'New message' };`.
> - Display the notification using the browser API:
>   `event.waitUntil( self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192x192.png', badge: '/badge-72x72.png' }) );`
> - Add a `notificationclick` listener to focus the open app tab or open a new window when the user taps the notification.

#### task 6.3.3: Implement Service Worker Background Decryption for Rich OS Notifications
- Expand the `sw.js` script to intercept the generic push event and keep the Service Worker alive using `event.waitUntil()`.
- Perform a background network request to the PocketBase REST API to fetch the newly arrived, encrypted message blob.
- Initialize the Libsodium WebAssembly module and the Dexie local database entirely within the background Service Worker context.
- Verify the signature, decrypt the payload locally, and display the rich, plaintext OS notification (e.g., "Alice: Hello!") without ever exposing the plaintext to Apple/Google push servers.

##### Jules prompt
> **Goal:** Transform the generic, zero-knowledge Web Push into a rich, plaintext OS notification by running the End-to-End Encrypted decryption pipeline directly inside the background Service Worker.
> 
> **Instructions:**
> You are finalizing the progressive web app functionality for `atoll chat`. In Task 6.3.2, we sent a generic ping to the device. Now, we must wake up the Service Worker, securely fetch the encrypted data, decrypt it using the local IndexedDB keys, and present the actual message to the user.
> 
> **CRITICAL PWA DIRECTIVES:**
> 1. A Service Worker operates on a strict lifecycle. You **must** wrap all asynchronous fetching and decryption logic inside `event.waitUntil()` or the browser will terminate the worker before decryption finishes.
> 2. The Service Worker has no access to the DOM or the `coralite` $state. It must instantiate its own independent connection to `Dexie` and `libsodium-wrappers`.
> 
> **1. task: Intercept and Extend the Push Event**
> - Open `public/sw.js`. Locate the `self.addEventListener('push', (event) => { ... })` block from the previous task.
> - Replace the synchronous `showNotification` call with an asynchronous wrapper: 
>   `event.waitUntil((async () => { /* Decryption logic goes here */ })());`
> 
> **2. task: Background Network & DB Initialization**
> - Inside the async block, initialize Dexie: `const db = new Dexie('AtollChatDB');` and define the schema for `local_rooms` and `local_messages` just like you did in the Web Worker.
> - Import Libsodium (via `importScripts` if not already imported) and `await sodium.ready`.
> - Because this is a background sync, we don't have an active PocketBase SSE connection. Perform a standard REST API fetch to get the most recent message:
>   `const response = await fetch('https://your-pocketbase-url.com/api/collections/messages/records?sort=-created&limit=1');`
> - Parse the JSON to extract the latest hostile-server payload (`record`).
> 
> **3. task: The Background Decryption Pipeline**
> - Fetch the required keys from the local database:
>   - Get the room: `const room = await db.local_rooms.get(record.room_id);`
>   - Extract the specific symmetric key from `room.key_history` matching `record.epoch_id`.
> - Convert the base64 `ciphertext`, `nonce`, and `epochKey` to `Uint8Array` buffers.
> - *Note: For brevity in this background task, you may skip the Ed25519 signature verification if it requires an extra network fetch for the public key, though in strict production, you should verify it.*
> - Decrypt the message: `const decryptedBuffer = sodium.crypto_secretbox_open_easy(ciphertextBuffer, nonceBuffer, epochKeyBuffer);`
> - Parse the resulting string into the `plaintextObj` JSON.
> 
> **4. task: Displaying the Rich Notification**
> - Extract the user-friendly data. (e.g., `const senderName = "New Message";` or fetch the sender's username from a cached `local_users` table if you have one).
> - Determine the notification body. If `plaintextObj.type === 'text'`, use `plaintextObj.content`. If it's `'media'`, use `[Attachment]`. If it's a signaling event (`call_offer`), use `Incoming Call!`.
> - Finally, trigger the OS notification with the decrypted data:
>   `await self.registration.showNotification(senderName, { body: notificationBody, icon: '/icon-192x192.png', tag: 'atoll-chat-msg' });`
> - **Edge Case Handling:** Wrap the entire block in a `try/catch`. If decryption fails (e.g., keys aren't synced), fallback to the generic notification: `await self.registration.showNotification('atoll chat', { body: 'You have a new secure message.' });`.