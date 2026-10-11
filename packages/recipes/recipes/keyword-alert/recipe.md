# Keyword Alert

A small bot that watches the room for a keyword and posts a brief
message whenever the keyword appears in a new message.

## What it does

Install the bot in a room and tell it which word or phrase to watch
for. From then on, whenever someone posts a message containing the
keyword, the bot responds with a short alert.

## Slots

- **keyword** — the word or phrase to watch for. Defaults to `urgent`.

  The keyword is interpreted as a regular expression. Simple words
  like `urgent` or `deploy` work as expected. Metacharacters (`.`,
  `*`, `+`, `?`, `(`, `)`, `[`, `]`, `|`) have their usual regex
  meaning. For example, `deploy|release` matches either word.

  Matching is case-insensitive.

## Capabilities

- **read_content** — to see the text of messages in the room.
- **post_message** — to post the alert.

## Constraints

- The bot posts publicly in the room. It has no private output mode.
- The bot fires on every match. It does not rate-limit or deduplicate
  alerts. In a busy room this can be noisy.

## When to use it

Use Keyword Alert when you want a lightweight signal for a specific
term — a project codename, an incident keyword, or a phrase the team
cares about. It is not a moderation tool and it does not understand
context.
