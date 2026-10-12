# Daily Reminder

A bot that posts a configurable message to a configured room on a
cron schedule. No user interaction is required.

## What it does

Install the bot and provide the target room id. The bot posts the
configured message to that room on the schedule you choose. The
message is editable from the client's bot settings page at any time.

Default schedule: every day at 09:00 UTC.

## Slots

- **roomId** — the room the reminder posts into. Required. Copy it
  from the room's settings page in the client.
- **cron** — a five-field cron expression. Defaults to `0 9 * * *`
  (every day at 09:00). No seconds. No macros.
- **timezone** — an IANA timezone name. Defaults to `UTC`.

## Settings

- **message** — the text posted on each fire. Defaults to
  "Daily check-in". User-scoped: changing it applies to every room
  the bot is granted in, but only the configured `roomId` receives
  the reminder.

## Capabilities

- **post_message** — to post the reminder and the install message.

## Constraints

- **The room id is fixed at build time.** To change the target room,
  rebuild the bot.
- **The reminder posts to one room.** It does not fan out to every
  room the bot has been granted in.
- **No user interaction.** The bot does not respond to commands or
  messages. Its only output is the scheduled post.
- **Missed fires.** If the runtime is offline when a fire is due, the
  fire is skipped unless the operator enables catch-up in the runtime
  configuration.

## When to use it

Daily Reminder is useful for recurring announcements — standup
reminders, weekly summaries, recurring prompts — that do not need to
be triggered by anything a user does. It is also a reference for
authors writing scheduled recipes: it shows how `schedule-task`,
`settings-read`, and `post-response` compose when the handler has no
room context of its own.
