# Sticky

A command bot that posts an operator-configured message to the room.
The message is set from the client's bot settings UI and can be
changed at any time without rebuilding the bot.

## What it does

Install the bot in a room. The operator sets the `message` setting
from the bot's settings page. Then anyone in the room can use:

```
/say
```

The bot posts the configured message publicly.

## Commands

### `/say`

Posts the configured message to the room. Takes no arguments.

## Settings

- **message** — the text that `/say` posts. Defaults to "Sticky is
  ready." This is a user-scoped setting: it applies across every room
  the operator has granted the bot in.

## Capabilities

- **read_commands** — to receive the `/say` invocation.
- **post_message** — to post the configured message and the install
  message.

## Constraints

- **The message is user-scoped.** It is not per-room. Changing it in
  one room's settings page changes it everywhere the bot is granted.
- **The message is posted publicly.** There is no private output
  mode.
- **The install message is fixed.** It announces the bot's presence
  and does not read the setting.
- **An empty message is rejected.** If the operator clears the setting
  value, `/say` fails because `post-response` refuses to post an
  empty string.

## When to use it

Sticky is useful when a bot needs to say the same thing repeatedly —
a reminder, a signature, a rule — and the text changes often enough
that rebuilding the bot each time is inconvenient. It is also a
reference for authors writing recipes that read operator settings:
it shows how `settings-read` composes with `{{.}}` and an output
primitive.
