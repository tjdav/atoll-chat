# Message Thread View (`view-chat`)

`view-chat.html` is the primary detail surface component for the `core.chat` first-party extension. It fetches room messages, member metadata, and read states from local storage repositories, formats and groups messages into bubbles, handles scroll positioning and local read state advancement, renders date separators and unread message dividers, and mounts the message composer at the bottom.

## 1. Purpose

The message thread surface presents the chronological conversation history for a selected room (`detail=chat&id=<roomId>`) and provides the composer interface for local message sending. It serves as the main detail panel in the explorer pattern shell layout when interacting with conversations.

## 2. Data Sources

The view reads asynchronously from five domain repositories via `ctx.storage.repos()`:

- **`rooms`**: Fetches cached room metadata via `repos.rooms.get(roomId)`.
- **`roomMembers`**: Fetches room membership lists via `repos.roomMembers.listInRoom(roomId)`.
- **`users`**: Resolves member display names via `repos.users.get(userId)`.
- **`messages`**: Fetches application messages ordered newest-first via `repos.messages.listApplicationsInRoom(roomId, { limit: 500 })` and reverses them for chronological display.
- **`reactions`**: Fetches room reactions via `repos.reactions.listForRoom(roomId)` and executes toggles via `toggleReaction`.
- **`readState`**: Fetches and updates the user's read position via `repos.readState.getForRoom(roomId, userId)` and `repos.readState.upsert(...)`.

## 3. Assembly Logic

Pure message assembly functions are implemented in `packages/app/src/lib/views/view-chat-data.js`:

- `safeParsePayload(json)`: Gracefully parses JSON string payloads.
- `summarizePayload(payload)`: Maps payload types to text or localized placeholder keys.
- `groupMessages(messages, { windowMs })`: Clusters consecutive messages by sender within a 5-minute time window.
- `insertDateSeparators(groups, { now })`: Inserts date pills ('Today', 'Yesterday', or formatted date strings) when calendar days change.
- `findNewMessagesDivider(messages, lastReadMessageId)`: Computes the array index for the "New messages" divider.
- `formatTime(timestamp, { locale })`: Formats timestamps into short time strings (e.g. '14:32').
- `formatDateLabel(timestamp, now)`: Formats date labels using calendar day comparison.

The component dynamically imports this module inside its `client()` block (`await import('../../lib/views/view-chat-data.js')`).

## 4. Bubble Layout

Individual messages render as `<message-bubble>` instances with state communicated via host-reflected boolean attributes:

- **Alignment**: Outgoing messages (`isOwn: true`) align to the right with outgoing styling (`--bubble-outgoing`). Incoming messages align to the left.
- **Avatars**: `<ui-profile>` avatar displays on incoming messages on the last bubble in a group (`isLastInGroup: true`).
- **Sender Names**: Sender display name renders above incoming messages on the first bubble in a group (`isFirstInGroup: true`).
- **Meta Row**: Displays short timestamp and local status indicators ('Queued', 'Sending…', 'Failed').
- **Tombstones**: Soft-deleted messages (`deleted_at != null`) render with italic muted styling (`isTombstone: true`) and body text "This message was deleted."
- **Pending/Failed States**: Unconfirmed outgoing messages display opacity (`isPending: true`) or error border (`isFailed: true`).
- **Reactions Container**: `<div class="bubble-reactions" ref="reactions">` displays below the bubble. Styled with `:empty { display: none; }` to collapse cleanly when no reactions exist.

## 5. Message Grouping Rules

Messages are grouped into consecutive clusters when:
1. The sender ID remains identical across adjacent messages.
2. The `created_at` timestamp gap between adjacent messages is less than or equal to 5 minutes (`300,000 ms`).

When the sender changes or the gap exceeds 5 minutes, a new group is started.

## 6. Date Separators

Date separators render as `<date-separator>` pills (`role="separator"`) centered in the thread. A date separator is placed:
- Before the first message group in the thread.
- Before any subsequent group whose first message's calendar day differs from the previous group's last message's calendar day.

## 7. New Messages Divider

When entering a thread with unread messages, a `.chat__divider` row ("New messages") renders immediately after the message matching `read_state.last_read_message_id`. If `last_read_message_id` is null, un-cached, or points to the newest message, no divider is rendered.

## 8. Scroll Behavior and Read State

- **Initial Load**: Scrolls to the bottom of the thread immediately after initial render (`scrollTop = scrollHeight`).
- **Scroll Button**: A floating scroll-to-bottom action button appears when distance from the bottom exceeds `80px`. Clicking it smooth-scrolls to the bottom.
- **Read State Advancement**: As the user reads and stays near the bottom (`<= 80px`), a debounced function (500ms) updates the local `read_state` table via `repos.readState.upsert`.

## 9. Composer and Local Send Path

The bottom of the chat panel mounts `<message-composer>` inside a `<footer class="chat__composer">` container.

### 9.1 Component Attributes and Events

`<message-composer>` accepts the following attributes:
- `placeholder`: Localized placeholder text for the input textarea.
- `attachLabel`: Localized ARIA label for the file attachment button (`+`).
- `emojiLabel`: Localized ARIA label for the emoji & sticker picker button (`☺`).
- `readaloudLabel`: Localized ARIA label for the read aloud toggle button (`🔊`).
- `inputLabel`: Localized ARIA label for the input textarea.
- `sendLabel`: Localized ARIA label for the send action button (`➤` / `🎤`).
- `disabled`: Boolean indicating whether input and send are disabled.
- `hasText`: Reflects whether text is present in the input textarea.

Events emitted by `<message-composer>`:
- `composer:send`: Emitted when the user submits text (Enter on desktop or clicking send button) with detail `{ text }`.
- `composer:attach`: Emitted when clicking the attach button (`{}`).
- `composer:emoji`: Emitted when clicking the emoji button (`{}`).
- `composer:readaloud`: Emitted when clicking the read aloud button (`{}`).

### 9.2 Send Orchestration (`sendMessage`)

When `view-chat` receives `composer:send`, it calls `sendMessage({ deps, roomId, text })` from `packages/app/src/lib/views/send-message.js`:

1. **Validation**: Calls `buildTextPayload(text)`. Returns `{ skipped: true, reason: 'empty' }` if text is empty or whitespace-only.
2. **Client ID Resolution**: Reads `client_id` from `storage.meta.get('client_id')`. On cold boot, generates a random ID via `generateLocalMessageId(crypto)` and persists it to `_meta`.
3. **Sequence Calculation**: Reads the newest message in the room via `repos.messages.listApplicationsInRoom(roomId, { limit: 1 })` and computes `epoch` and `seq` via `computeNextSeq`. If the room has no application messages, uses `{ epoch: 0, seq: 1 }`; otherwise bumps `seq` by 1.
4. **Message Persistence**: Generates a `local_<uuid>` ID and upserts a row into `repos.messages` with `localStatus: 'pending'`, `contentType: 'application'`, `decryptedPayload`, and marker `ciphertext`.
5. **Outbox Enqueue**: Calls `repos.outbox.enqueue({ messageId, roomId })`.
6. **Read State Advance**: Calls `repos.readState.upsert(...)` to advance the sender's read position.
7. **Thread Re-render**: `view-chat` resets `currentRoomId = null` and reloads, displaying the new optimistic message bubble with `is-pending="true"`.

### 9.3 Ciphertext Marker (`stub:`)

`encodeCiphertextStub(payload)` prefixes UTF-8 JSON bytes with `stub:`. This marker satisfies the non-NULL column constraint until the MLS CoreCrypto encryption integration replaces it with real ciphertext.

## 10. Message Context Menu

The message context menu allows users to perform local actions on thread messages.

### 10.1 Trigger Mechanics and Browser Menu Suppression
- **Desktop**: Right-clicking anywhere within a message row (`contextmenu` event) prevents the default browser context menu (`event.preventDefault()`) and emits `bubble:contextmenu` with `{ messageId, x, y }`.
- **Touch / Pen**: Long-pressing for 500ms without pointer cancellation emits `bubble:contextmenu` with `{ messageId, x, y }`.

### 10.2 Menu Component Contract
`<message-context-menu>` (`packages/app/src/components/composed/message-context-menu.html`) accepts attributes:
- `open`: Boolean reflecting whether the popover menu is visible.
- `x`, `y`: Absolute pixel coordinates for menu position (`position: fixed`).
- `messageId`: ID of the target message.
- `canUnsend`: Boolean indicating whether Unsend is available.
- `canCopy`: Boolean indicating whether Copy is available (`!deleted_at`).
- `canReact`: Boolean indicating whether Reactions are available (`!deleted_at`).

Emitted events:
- `menu:react`: `{ messageId, reaction }`
- `menu:copy`: `{ messageId }`
- `menu:unsend`: `{ messageId }`
- `menu:delete`: `{ messageId }`
- `menu:close`: `{}`

Dismissal occurs on outside click (`document.addEventListener('click')`) or pressing the `Escape` key.

### 10.3 Action Semantics & Unsend Predicate
- **Copy (`copyMessage`)**: Reads the message, parses the text summary, and writes to `navigator.clipboard.writeText`.
- **Delete for me (`deleteForMe`)**: Executes a local hard delete via `repos.messages.remove(messageId)`. The message is removed from the local view immediately.
- **Unsend (`unsend`)**: Executes a soft delete via `repos.messages.markDeleted(messageId)`. The message bubble updates to a muted tombstone pill ("This message was deleted.").
- **Unsend Availability (`isUnsendAvailable`)**: True iff the message exists, the current user is the sender (`sender_user_id === userId`), `local_status === 'sent'`, and the creation timestamp is within 24 hours (`Date.now() - created_at <= 86,400,000`).

## 11. Message Editing

Message editing allows authors to modify sent text messages within a 15-minute window.

### 11.1 Trigger and Availability Predicate
The Edit action appears on `<message-context-menu>` when `isEditAvailable(message, userId)` evaluates to true:
- The message is owned by the current user (`sender_user_id === userId`).
- The message has `local_status === 'sent'`.
- The message is not soft-deleted (`deleted_at == null`).
- The message was sent within the 15-minute window (`Date.now() - created_at <= 15 * 60 * 1000`).

### 11.2 Composer Morph
Selecting Edit morphs `<message-composer>` into edit mode:
- Displays a top editing banner (`.composer-banner`) showing "Editing" and a cancel button (`✕`).
- Prefills the input textarea with the existing message text summary.
- Replaces the send glyph with a checkmark glyph (`✓`).
- Emits `composer:edit-submit` with `{ text }` on submit, or `composer:edit-cancel` on cancel.

### 11.3 Prefill Observation and Microtask Deferral
To update both the DOM value and `hasText` state when receiving `prefill`, the composer uses `observe('prefill', ...)` with `queueMicrotask`. Deferring `state.hasText` to a microtask breaks synchronous execution and prevents reactive state mutation loops during observation.

### 11.4 Edit Orchestration (`editMessage`)
Executing an edit via `editMessage({ deps, messageId, newText, userId })` (`packages/app/src/lib/views/edit-message.js`):
1. **Lazy Version 0**: If `message_versions` holds zero records for `messageId`, writes version 0 with the original row's `ciphertext`, `decrypted_payload`, and `editedAt = created_at`.
2. **Next Sequence**: Reads existing versions and calculates `nextSeq = max(edit_sequence) + 1`.
3. **Version Record**: Writes a new version record to `message_versions` with `editSequence: nextSeq` and `editedAt: now`.
4. **Base Message Row**: Updates the base message row in `messages` with the new `ciphertext`, `decryptedPayload`, `edited_at: now`, and `updated_at: now`.

### 11.5 "Edited" Indicator
Message bubbles with `edited_at != null` render an italic "Edited" indicator in the message footer next to the timestamp.

## 12. Reactions and Reaction Chips

Reactions allow users to react to messages with a default set of six emoji.

### 12.1 Default Emoji Set
`DEFAULT_EMOJI` in `packages/app/src/lib/views/reactions.js` is a frozen array of six emoji: `['👍', '❤️', '😂', '😮', '😢', '🎉']`.

### 12.2 Reaction Picker in Context Menu
The context menu displays the horizontal emoji row at the top above action items when `canReact` is true (`!deleted_at`). Tombstoned messages hide the emoji picker row. Clicking an emoji button emits `menu:react` with `{ messageId, reaction }`.

### 12.3 Reaction Chip Component (`reaction-chip`)
`<reaction-chip>` (`packages/app/src/components/composed/reaction-chip.html`) renders an emoji and aggregated user count. Attributes:
- `reaction`: Emoji character string.
- `count`: Number of distinct users who reacted with this emoji.
- `messageId`: Target message ID.
- `isOwn`: Boolean reflecting whether the current user reacted with this emoji (`is-own` host attribute).

Clicking a chip emits `reaction:toggle` with `{ messageId, reaction }`.

### 12.4 Toggle Orchestration (`toggleReaction`)
`toggleReaction({ repos, messageId, userId, clientId, reaction })`:
- Reads `repos.reactions.hasReacted(messageId, userId, reaction)`.
- If true: removes the user's active reaction row via `repos.reactions.remove(...)` and returns `{ reacted: false }`.
- If false: adds a new reaction row via `repos.reactions.add(...)` with `clientId` from `storage.meta.get('client_id')` and returns `{ reacted: true }`.

### 12.5 Aggregation and Deduplication
The view aggregates reactions per message deduplicated per user (`COUNT(DISTINCT sender_user_id)`). Multi-device reactions from the same user count once.

## 13. Known Limitations and Deferred Features

- **MLS Encryption Deferred**: Payload is stored as plaintext JSON in `decrypted_payload` with a `stub:` marker in `ciphertext`.
- **Outbox Send Loop Deferred**: Messages remain `localStatus: 'pending'` until the background outbox sender loop is implemented.
- **Draft Persistence Deferred**: Text in the composer is held in component state; drafts repository persistence is a follow-on task.
- **Stub Buttons**: The attach, emoji, and read-aloud buttons render as disabled stub controls until follow-on tasks wire their functionality.
- **No Live WebSocket**: Thread does not subscribe to incoming socket events yet (WebSocket task).
- **Deferred Emoji Picker**: Full `emoji-picker-element` integration for non-default emoji is deferred.
- **Deferred Wire Protocol**: Reaction updates sent via WebSocket/HTTP wire protocol are deferred to the WebSocket task.

## 14. Inline Header Surface

The thread component currently renders an inline header (`<header class="chat__header">`) displaying the room or participant name. Per Spec §6.7, room title rendering will eventually be owned by the shell header. The inline header is a temporary surface deviation documented for migration in a follow-on shell header task.
