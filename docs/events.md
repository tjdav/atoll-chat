# Event Documentation

This document describes the unified event naming convention and lists the events used across the Atoll Chat application.

## Naming Convention

All events emitted via the global event bus (`$bus`) follow a unified `<relation>:<event>` format:

- **Format:** `<relation>:<event_name>` (e.g., `ui:show_toast`, `db:new_local_data`)
- **Casing:** All lowercase.
- **Separators:** 
    - `:` separates the relational source from the specific event type.
    - `_` (underscore) separates words within the relation or event name.
- **Automatic Enforcement:** The `eventBus` plugin (`src/plugins/event-bus.js`) automatically transforms event names to lowercase and replaces hyphens with underscores. If an event is emitted without a relation (no colon), it defaults to the `app:` relation.

---

## Event Categories

### UI Events (`ui:`)
Manage user interface states, modals, and notifications.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `ui:open_avatar_editor` | Opens the interactive avatar cropping tool. | `File` (Image) |
| `ui:avatar_editor_applied` | Emitted when cropping is finished and optimized. | `Blob` (WebP) |
| `ui:show_toast` | Displays a global Bootstrap toast notification. | `{ message, type }` |
| `ui:file_selected` | Emitted when a file is picked for upload. | `{ file }` |
| `ui:mic_clicked` | Triggered when the voice recording button is clicked. | None |
| `ui:send_clicked` | Triggered when the message send button is clicked. | None |
| `ui:show_reaction_picker` | Opens the emoji reaction picker for a message. | `{ targetId, x, y }` |
| `ui:hide_reaction_picker` | Closes the emoji reaction picker. | None |
| `ui:emoji_selected` | Emitted when an emoji is chosen from the picker. | `{ emoji }` |
| `ui:open_edit_room` | Opens the room settings/management modal. | `Room` object |
| `ui:open_create_room` | Opens the room creation modal. | None |
| `ui:trigger_kick_user` | Triggers the flow to remove a user from a group. | `{ room_id, user_id }` |
| `ui:close_room_details` | Closes the room information sidebar. | None |
| `ui:media_loaded` | Notifies the timeline that an asset (image/video) has finished loading. | None |
| `ui:voice_ready` | Emitted when a voice recording is captured and ready to send. | `{ blob, duration, waveform }` |
| `ui:voice_discarded` | Emitted when a voice recording is cancelled. | None |
| `ui:cancel` | Generic UI cancellation event. | None |
| `ui:dismiss_link_preview` | Closes the link metadata preview in the chat input. | `{ url }` |
| `ui:selection_made` | Signals that a selection (chat, media, etc.) has been confirmed by the user. | None |
| `ui:scroll_to_bottom` | Triggers the timeline to scroll to the bottom. | `{ smooth }` (Boolean) |
| `ui:focus_input` | Focuses the message input textarea. | None |
| `ui:open_mobile_nav` | Opens the mobile navigation drawer. | None |
| `ui:prompt_p2p_consent` | Opens the consent modal for large direct peer-to-peer file transfer. | `{ transferId, senderName, filename, size }` |
| `ui:prompt_p2p_reroute` | Opens the prompt to reroute an upload to P2P direct transfer. | `{ file, targetUserId }` |

### Database & Sync (`db:`, `sync:`)
Handle data persistence and server synchronization states.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `db:new_local_data` | Notifies that new messages or metadata have been saved to IndexedDB. | `{ room_id }` |
| `db:new_local_room` | Notifies that a room's local metadata has been created or updated. | `{ room_id }` |
| `db:room_deleted` | Notifies that a room's local metadata and messages have been deleted from IndexedDB. | `{ room_id }` |
| `sync:complete` | Emitted when historical catch-up synchronization finishes. | None |

### Room & Message (`room:`, `message:`)
Events related to chat rooms and message delivery/interaction.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `room:select` | Signals that a chat room has been selected/activated. | `{ room_id }` |
| `room:toggle_read` | Request to toggle the read/unread status of a room. | `{ room_id, isUnread }` |
| `room:toggle_mute` | Request to toggle the mute status of a room's notifications. | `{ room_id, isMuted }` |
| `room:delete` | Request to delete a room or leave a group chat. | `{ room_id, isGroup }` |
| `room:edit` | Request to retrieve room info and trigger the room edit flow. | `{ room_id }` |
| `room:read_state_changed` | Triggered when a room is marked as read or active selection changes. | `room_id` |
| `room:member_updated` | Notifies that a participant's read status or metadata has changed. | `{ room_id }` |
| `room:theme_updated` | Emitted when a room's custom styling theme is updated. | `{ room_id, theme }` |
| `message:sent` | Emitted after a message is successfully encrypted and uploaded. | `Message` object |
| `message:send_reaction` | Request to send a reaction to a specific message. | `{ targetId, emoji }` |
| `message:scroll_to` | Triggers the timeline to jump to a specific message ID. | `{ messageId }` |

### Media Player (`media:`)
Controls for the global headless media engine and media selections.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `media:toggle` | Toggles play/pause for the active audio or video. | None |
| `media:play` | Starts playback for a specific asset. | `{ mediaId, type }` |
| `media:pause` | Pauses current playback. | None |
| `media:next` | Moves to the next item in the media carousel. | None |
| `media:prev` | Moves to the previous item in the media carousel. | None |
| `media:seek` | Changes the current playback position. | `{ percent }` or `{ time }` |
| `media:select` | Signals that a media item (music, pictures, or videos) has been selected. | `{ assetId, type }` (where type is 'music', 'pictures', or 'videos') |
| `media:video_progress` | Notifies about video compression/processing progress. | `{ id, progress }` |
| `media:audio_progress` | Notifies about audio file compression or processing progress. | `{ id, progress }` |

### Calls (`call:`)
Events for real-time WebRTC audio and video communication.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `call:initiated_locally` | Triggered when the local user starts a new call. | `{ localStream }` |
| `call:incoming` | Notifies the UI of a new incoming call offer. | `{ room_id, offer, senderId }` |
| `call:ended` | Signals that a call session has terminated. | `{ room_id }` |
| `call:remote_track_arrival` | Emitted when a remote media track is received and ready for display. | `{ room_id, stream, track }` |
| `call:local_stream_available` | Emitted when the local camera/mic stream is initialized. | `{ stream }` |
| `call:accept_clicked` | Emitted when the user accepts an incoming call from the call view overlay. | None |
| `call:reject_clicked` | Emitted when the user rejects an incoming call. | None |
| `call:toggle_audio_clicked` | Emitted when the user toggles local microphone audio on/off. | None |
| `call:toggle_video_clicked` | Emitted when the user toggles local camera video on/off. | None |
| `call:pip_clicked` | Emitted when the user requests to switch call layout to Picture-in-Picture. | None |
| `call:end_clicked` | Emitted when the user hangs up from the control bar interface. | None |

### P2P Direct File Transfers (`action:`)
These background flow events coordinate WebRTC direct device-to-device file transfers.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `action:execute_p2p_transfer` | Dispatches file metadata to initiate P2P negotiation with peer. | `{ file, targetUserId }` |
| `action:execute_p2p_accept` | Informs WebRTC transfer plugin to accept the incoming transfer request. | `{ transferId }` |
| `action:execute_p2p_reject` | Informs WebRTC transfer plugin to reject the incoming transfer request. | `{ transferId }` |

### Video Grid & Picture-in-Picture (`video_grid:`, `pip:`)
Controls for call participant layouts and floating overlays.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `video_grid:sync` | Synchronizes active tracks, mute/unmute indicators, and grid positioning. | None |
| `pip:expand` | Returns the floating PiP window to the main chat grid. | None |
| `pip:reset_position` | Resets the PiP window to its default bottom-right anchor. | None |

### Authentication & Push Notifications (`auth:`, `push:`)
User session, vault security, and push synchronization events.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `auth:logout` | Triggers the global logout and cleanup process. | None |
| `auth:unlocked` | Emitted after successful vault password/passkey verification. | `{ keys, userRecord }` |
| `auth:totp_passed` | Emitted after successful TOTP multi-factor verification. | None |
| `push:decryption_error` | Signals that a background push notification could not be decrypted. | `{ error }` |

### Global App State (`app:`)
Network state transitions and global system signals.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `app:request_reconnect` | Emitted by the offline banner to request a manual reconnect attempt. | None |
| `app:reconnected` | Emitted when the client successfully regains active internet/server connection. | None |

### Worker (`worker:`)
Communication between the main thread and the background cryptographic worker.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `worker:ready` | Emitted when the worker script is fully loaded. | None |
| `worker:initialized` | Emitted after the worker successfully loads identity keys. | `{ user_id }` |

### Component-Specific Events (`waveform_player:`)
These events are used for internal component-level coordination.

| Event Name | Description | Payload |
|------------|-------------|---------|
| `waveform_player:play` | Emitted when a waveform player starts playing, coordinating exclusive audio playback. | `{ audioId }` |
