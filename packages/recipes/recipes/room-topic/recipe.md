# Room Topic

A per-room topic that anyone in the room can set and show.

## What it does

Install the bot in a room. Then anyone in the room can set a topic
and display it.

```
/topic Deploy freeze until Friday
/topic-show
```

`/topic` updates the topic for this room only, and replies privately
to confirm. `/topic-show` posts the topic publicly.

## Commands

### `/topic <text>`

Sets the room's topic.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | string | yes | The new topic text. |

The confirmation is a private reply to the invoker.

### `/topic-show`

Posts the room's current topic publicly. Takes no arguments. If the
topic has never been set, posts the default value.

## Settings

- **topic** — the topic text for this room. Defaults to "No topic
  set." This is a room-scoped setting: each room has its own value.

The operator can also view and edit the topic from the bot's settings
page in the client. Changes made there appear immediately on the next
`/topic-show`.

## Capabilities

- **read_commands** — to receive the `/topic` and `/topic-show` invocations.
- **post_message** — for the install message and for `/topic-show`.

## Constraints

- **The topic is per room.** Changing it in one room does not affect
  any other room the bot is granted in.
- **Both commands require room context.** They cannot be invoked from
  a direct message or any context where the runtime has no room id.
- **The install message is fixed.** It announces the bot's presence
  and does not read the topic.
- **The topic has a default.** A room that has never configured a
  topic shows the value "No topic set."

## When to use it

Room Topic is useful for small rooms that need a lightweight "what
are we working on right now" field. It is also a reference for
authors writing room-scoped recipes: it shows how `settings-write`
and `settings-read` compose with the `scope: 'room'` config, and how
a single recipe can have one private command and one public one.
