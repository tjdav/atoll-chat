# Notes

A shared scratchpad for the room. Save short notes under a name and
recall them later.

## What it does

Install the bot in a room. Everyone in the room can then save and
recall notes. Both commands reply privately — only the invoker sees
the confirmation or the retrieved value.

```
/save deploy-url https://deploy.example.com
/recall deploy-url
```

The second command returns `"deploy-url" = https://deploy.example.com`
to whoever ran it, and to no one else.

## Commands

### `/save <name> <value>`

Saves a value under a name. Replies privately to confirm.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | The key to save under. |
| `value` | string | yes | The text to save. |

### `/recall <name>`

Retrieves the value saved under a name. Replies privately with the
value.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | The key to retrieve. |

## Capabilities

- **read_commands** — to receive the `/save` and `/recall` invocations.
- **post_message** — for the install message.

## Constraints

- **The pad is shared across the room.** Every invoker reads and writes
  the same set of names. There is no per-user or per-command scoping.
  The bot has no user identity on the engine side.
- **Recalling a name that was never saved produces an error.** The SDK
  reports a generic failure. There is no "not found" message.
- **Values are stored as text.** They are not parsed. A value that
  looks like JSON is stored as a string.
- **The pad is local to the instance.** It is not synced across
  instances and is not backed up unless the operator backs up the
  runtime's storage.

## When to use it

Notes is useful when a small group needs a place to stash short strings
— URLs, IDs, commands, one-line reminders — without leaving the chat.
It is not a substitute for a real notes app; it is a convenience for
things that come up in conversation.
