# Conversation List View (`view-chats`)

`view-chats.html` is the primary list surface component for the `core.chat` first-party extension. It fetches room records from local storage repositories, assembles structured view model rows, renders the conversation list imperatively, handles row navigation, and manages the empty state when no rooms exist.

## 1. Purpose

The conversation list provides users with an overview of all active chats. It serves as the primary entry point for selecting a conversation in the explorer pattern shell layout (`rail=core.chat`).

## 2. Data Sources

The view reads asynchronously from seven domain repositories via `ctx.storage.repos()`:

- **`rooms`**: Fetches all cached room records via `repos.rooms.list({ limit: 500 })`.
- **`roomOrder`**: Fetches explicit room order records via `repos.roomOrder.list()`.
- **`readState`**: Fetches the current user's read state records via `repos.readState.listForUser(userId)`.
- **`drafts`**: Fetches unsent room draft records via `repos.drafts.list()`.
- **`roomMembers`**: Fetches member lists for each room via `repos.roomMembers.listInRoom(roomId)`.
- **`users`**: Resolves member display names via `repos.users.get(userId)`.
- **`messages`**: Fetches the newest application message per room via `repos.messages.listApplicationsInRoom(roomId, { limit: 1 })`.

## 3. Assembly Logic

Row data assembly is implemented as pure, testable functions in `packages/app/src/lib/views/view-chats-data.js`:

- `assembleRooms({ rooms, orderRows, readStates, drafts, lastMessagesByRoom, displayNamesByRoom, memberCountsByRoom, currentUserId, translations })`
- `resolveRoomName(room, displayNames, translations)`
- `resolvePreview(lastMessage, displayNames, currentUserId, translations)`
- `computeUnread(readState, lastMessage)`
- `formatRelativeTime(ms, now)`

The component's `client()` block performs dynamic dynamic import (`await import('../../lib/views/view-chats-data.js')`) and delegates all view-model assembly to these exported pure functions.

## 4. Ordering Rules

Rooms are ordered according to the following precedence:

1. **Explicit Room Order**: Rooms present in `roomOrder` are placed first, ordered by position index (`0..N`).
2. **Updated Timestamp Fallback**: Rooms missing from `roomOrder` are appended, ordered by `updated_at DESC`.

## 5. Room Name Derivation

Room names are derived based on explicit configuration and member counts:

- **Explicit Name**: If `room.name` is set, it is used verbatim.
- **1:1 Rooms** (1 other member): Uses the display name of the other member.
- **Group Rooms (2 other members)**: Joins both display names with a comma (`"Alice, Bob"`).
- **Group Rooms (>2 other members)**: Displays the first two member names followed by the remaining count (`"Alice, Bob + 2"`).
- **Fallback**: If no display names exist and the room has no name, returns the localized no-messages string (`chats_preview_no_messages`).

Current user display names are excluded from derived group names.

## 6. Preview Derivation

Previews display the newest application message payload or a localized type placeholder:

- **Current User Messages**: Prefixed with `"You: "` (`chats_preview_you_prefix`).
- **Other User Messages**: Prefixed with `"<SenderName>: "`.
- **Payload Types**:
  - `text`: Displays message text (`"<Prefix><text>"`).
  - `image`: Displays localized `"Photo"` string (`chats_preview_photo`).
  - `video`: Displays localized `"Video"` string (`chats_preview_video`).
  - `audio`: Displays localized `"Voice message"` string (`chats_preview_voice`).
  - `file`: Displays localized `"Document"` string (`chats_preview_document`).
  - `sticker`: Displays localized `"Sticker"` string (`chats_preview_sticker`).
- **No Messages / Unparseable**: Displays localized `"No messages yet"` string (`chats_preview_no_messages`).

## 7. Unread Indicator

A room displays an unread indicator dot (`isUnread: true`) when:

- The room has a last application message AND either:
  - The user has no `read_state` record for the room, OR
  - `read_state.last_read_message_id` does not match the room's newest application `message_id`.

If the room has no application messages, `isUnread` is `false`.

## 8. Draft Precedence

If an unsent draft exists for a room in `repos.drafts`, the draft text takes precedence over the message preview:

- `hasDraft` is set to `true`.
- `preview` displays the draft text string.
- CSS applies italic styling (`.row__preview--draft`).

## 9. Known Limitations

- **N+1 Message Queries**: Queries `listApplicationsInRoom(roomId, { limit: 1 })` per room. A future task adds a batch query optimization (`getLastPerRoom`).
- **No Unread Count**: Displays a binary unread dot only. Unread message count calculation is deferred.
- **Initials-Only Profiles**: `ui-profile` renders letter initials; decrypted attachment avatars are deferred.
- **No Mute / Session Indicators**: Indicators for muted rooms and active sessions are deferred.
- **No Room Creation UI**: Room creation action buttons are handled in a follow-on task.

## 10. Future Tasks

- Room creation dialogs and sheets.
- Room settings overlays and permission management.
- Drag-and-drop room list reordering.
- Filter chips (unread, mentions, muted).
- Live socket updates for real-time list re-ordering and preview updates.
