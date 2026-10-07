# Message Thread View (`view-chat`)

`view-chat.html` is the primary detail surface component for the `core.chat` first-party extension. It fetches room messages, member metadata, and read states from local storage repositories, formats and groups messages into bubbles, handles scroll positioning and local read state advancement, and renders date separators and unread message dividers.

## 1. Purpose

The message thread surface presents the chronological conversation history for a selected room (`detail=chat&id=<roomId>`). It serves as the main detail panel in the explorer pattern shell layout when interacting with conversations.

## 2. Data Sources

The view reads asynchronously from five domain repositories via `ctx.storage.repos()`:

- **`rooms`**: Fetches cached room metadata via `repos.rooms.get(roomId)`.
- **`roomMembers`**: Fetches room membership lists via `repos.roomMembers.listInRoom(roomId)`.
- **`users`**: Resolves member display names via `repos.users.get(userId)`.
- **`messages`**: Fetches application messages ordered newest-first via `repos.messages.listApplicationsInRoom(roomId, { limit: 500 })` and reverses them for chronological display.
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

## 9. Known Limitations and Follow-On Tasks

- **No Composer**: Message composition and text input are handled in a follow-on task (C-CHAT-8).
- **No Live WebSocket**: Thread does not subscribe to incoming socket events yet (WebSocket task).
- **No Attachments / Media**: Images, videos, voice clips, and documents render text placeholders. Media rendering is deferred.
- **No Editing / Deletion UI**: Context menus, message editing, and deletion actions are deferred (C-CHAT-9).
- **No Reactions**: Reaction badges and reaction pickers are deferred (C-CHAT-10).
- **No In-Thread Search or Read-Aloud**: Deferred to future feature tasks.

## 10. Inline Header Surface

The thread component currently renders an inline header (`<header class="chat__header">`) displaying the room or participant name. Per Spec §6.7, room title rendering will eventually be owned by the shell header. The inline header is a temporary surface deviation documented for migration in a follow-on shell header task.
