# Echo

A minimal command bot. It exposes a single `/echo` command and posts
its argument back to the room.

## What it does

Install the bot in a room and use the `/echo` command:

```
/echo hello world
```

The bot posts `hello world` in the room.

## Commands

### `/echo <text>`

Repeats the given text in the room.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | string | yes | The text to repeat. |

There is no default. Running `/echo` without an argument is rejected
by the runtime before the bot is invoked.

## Capabilities

- **read_commands** — to receive the `/echo` invocation.
- **post_message** — to post the response in the room.

## Constraints

- The bot posts publicly. It has no private output mode.
- The bot does not prefix the response with the invoker's name or
  id. The echoed text appears exactly as it was given.

## When to use it

Echo is a teaching recipe. It demonstrates the command pipeline end
to end — argument declaration, argument unwrapping, template
substitution, and output — in the smallest possible package. It is
useful as a reference for authors writing more substantive recipes,
and as a smoke test for a fresh installation.
