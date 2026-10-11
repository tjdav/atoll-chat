# Quote

A command bot that fetches a random quote from a JSON endpoint and
replies privately to the invoker.

## What it does

Install the bot in a room and use the `/quote` command:

```
/quote
```

The bot fetches a random quote from the configured endpoint and
replies privately with the quote and its author. Only the invoker
sees the reply.

## Commands

### `/quote`

Fetches a random quote. Takes no arguments.

## Slots

- **endpoint** — the URL the bot fetches from. Defaults to
  `https://api.quotable.io/random`.

  The endpoint must return JSON of the form:

  ```json
  { "content": "...", "author": "..." }
  ```

  Other shapes produce a runtime error when the reply template tries
  to resolve `{{content}}` or `{{author}}` against a body that lacks
  them.

## Capabilities

- **read_commands** — to receive the `/quote` invocation.
- **post_message** — for the install message.

## Constraints

- The endpoint must return JSON with `content` and `author` string
  fields.
- The bot makes one HTTP request per `/quote` invocation. It does not
  cache, rate-limit, or deduplicate.
- The reply is delivered privately to the invoker. There is no public
  mode.
- Network errors, non-2xx responses, and malformed JSON produce a
  generic command failure. The recipe does not have a fallback path.

## When to use it

Quote is useful as a lightweight morale feature in a small room. It
is also a reference for authors writing recipes that consume external
APIs — it shows how a command, an HTTP fetch, and a private reply
compose.
