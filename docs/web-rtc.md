# WebRTC & P2P Signaling Architecture

Atoll Chat implements zero-knowledge, end-to-end encrypted voice/video calls and direct peer-to-peer (P2P) file transfers. This document provides a detailed technical overview of these two WebRTC-based subsystems, their signaling workflows, worker-level decryption pipelines, and audio mechanics.

---

## 1. Subsystem Architecture Overview

To maintain domain separation, WebRTC signaling in Atoll Chat is split into two distinct subsystems:

| Subsystem | Primary Core File | Purpose | Signaling Messages |
| :--- | :--- | :--- | :--- |
| **Voice & Video Calls** | `src/plugins/web-rtc-plugin.js` | Direct, real-time user-to-user calls with camera and microphone media sharing. | `call_offer`, `call_answer`, `call_end`, `ice_candidate` |
| **P2P File Transfers** | `src/plugins/webrtc-transfer-plugin.js` | Direct browser-to-browser large file transfer when file sizes bypass standard storage. | `p2p_transfer_request`, `p2p_accept`, `p2p_rejected`, `p2p_offer`, `p2p_answer`, `p2p_ice_candidate` |

Both pipelines use the same underlying end-to-end encrypted messaging transport. However, because signaling messages are highly transient, they are flagged as **ephemeral** to avoid polluting the persistent local database.

---

## 2. Ephemeral Real-time Routing Pipeline

When a peer sends or receives a signaling payload, it routes through a specialized background worker pipeline that separates ephemeral data from persistent user messages.

```
[Main Thread UI / Plugin]
          │ (sends/receives message via PocketBase)
          ▼
[Background Cryptographic Worker (worker.js)]
          │ (decrypts/encrypts and handles storage routing)
          ├──────► (If Persistent): Save to local SQLite/IndexedDB, emit 'db:new_local_data'
          └──────► (If Ephemeral): Emit direct 'db:new_local_data' event, BYPASS local DB save
```

### The Role of `isIncomingEphemeral`
To prevent signaling messages from cluttering the persistent local database (`local_messages` table), the background cryptographic worker (`src/workers/worker.js`) filters messages using a checklist named `isIncomingEphemeral`:

```javascript
const isIncomingEphemeral = [
  'p2p_transfer_request', 'p2p_accept', 'p2p_rejected', 'p2p_request_offer', 'p2p_offer', 'p2p_answer', 'p2p_ice_candidate',
  'ice_candidate', 'call_offer', 'call_answer', 'call_end'
].includes(type) || decryptedPayload.ephemeral
```

- **If `isIncomingEphemeral` is `true`**:
  1. The worker bypasses database storage entirely.
  2. The worker immediately posts the decrypted payload back to the main thread event bus (`$bus`) via `db:new_local_data`.
  3. This ensures low-latency delivery of signaling messages (especially high-frequency `ice_candidate` packets) without causing database locking or disk inflation.

---

## 3. Voice & Video Calls Signaling Flow

A typical voice or video call signaling sequence between Alice (initiator) and Bob (recipient) follows this pattern:

1. **Initiation**:
   - Alice clicks the call button. Her local status updates to `'active'`.
   - Alice retrieves local media tracks (`getUserMedia`) and creates her local peer connection.
   - Alice creates a WebRTC `offer` and signs/sends a `call_offer` signaling message.
   - Simultaneously, Alice plays a looping **dialing/calling ringback sound** locally while waiting.

2. **Reception**:
   - Bob's worker decrypts the `call_offer` and emits `db:new_local_data` to Bob's main thread.
   - Bob's UI triggers the `call-overlay` with an `'incoming'` state and plays his **ringtone**.

3. **Acceptance & Connection**:
   - Bob clicks **Accept**. His status becomes `'active'`, and his local ringtone stops.
   - Bob retrieves his local media tracks, creates his peer connection, applies Alice's remote description, and generates a WebRTC `answer`.
   - Bob sends a `call_answer` message back to Alice.
   - Both Alice and Bob begin gathering and exchanging `ice_candidate` signaling messages.
   - Once Alice receives Bob's `call_answer` or the WebRTC connection starts receiving Bob's track (`ontrack` arrival), Alice's local **dialing sound stops**.

4. **Teardown**:
   - If either Alice or Bob hangs up, a `call_end` message is dispatched.
   - Both peers release media tracks (`track.stop()`), close the peer connection, and reset their local `callStatus` state back to `'idle'`.

---

## 4. Call Audio & Ringtone Feedback

The calling feedback mechanism resides inside `src/components/call/call-overlay.html` and utilizes standard HTML5 `Audio` elements with robust garbage collection:

- **Ringtone (Receiver Side)**: Plays when `callStatus === 'incoming'`. Stops as soon as the status transitions to `'active'` (acceptance) or `'idle'` (rejection/cancel).
- **Dialing/Ringback Sound (Initiator Side)**: Plays when a call is `'initiated_locally'` (when the caller's overlay shows "Waiting for remote participant..."). Stops immediately once:
  - The first remote track is successfully attached (`remoteStream` is set).
  - Or the call status returns to `'idle'` (due to timeout, cancellation, or rejection).

Both audio sequences respect the user's `callSoundsEnabled` toggle and `mediaVolume` settings:

```javascript
const playRingtone = async () => {
  if (!$state.callSoundsEnabled || ringtoneAudio) {
    return
  }
  // Load default sound or custom-uploaded sound blob from storage
  let audioSource = '/sounds/ringtone.mp3'
  const customSound = await $storage.getConfig('custom_call_sound')
  if (customSound && customSound instanceof Blob) {
    audioSource = URL.createObjectURL(customSound)
  }
  ringtoneAudio = new Audio(audioSource)
  ringtoneAudio.loop = true
  ringtoneAudio.volume = $state.mediaVolume || 1.0
  await ringtoneAudio.play()
}
```
