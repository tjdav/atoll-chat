# Webhook Notify

A bot that listens for inbound HTTP webhooks and forwards a field
from the JSON body to its owner.

## What it does

Install the bot and give the external system the webhook URL. When
the system POSTs a JSON body containing a `message` field, the bot
sends that message to its owner as a private notification.

Example request:

```
POST /hooks/notify
Content-Type: application/json

{ "message": "Deploy succeeded on prod" }
```

The bot's owner receives `Webhook received: Deploy succeeded on prod`.

## Handlers

### `webhook`

Handles inbound HTTP requests on the configured path. Chain:

1. `webhook-receive` receives the request.
2. `transform` (pick `body`) extracts the raw body string.
3. `transform` (json) parses the body into an object.
4. `send-local` sends `Webhook received: {{message}}` to the owner.

## Slots

- **path** — the URL path the webhook listens on. Defaults to
  `/hooks/notify`. Must start with `/`.

## Capabilities

None. The bot does not read room messages, post to rooms, or use any
of the eight capability scopes. It exists only to receive webhooks
and notify its owner.

## Constraints

- **The webhook body must be JSON with a `message` string field.** A
  body that is not valid JSON throws at parse time. A valid JSON body
  without a `message` field throws at template resolution.
- **Notification is best-effort.** `send-local` is documented as
  non-durable. If the owner is offline when the webhook fires, the
  notification is lost. There is no retry.
- **No room output.** This recipe never posts to a room. If durable
  delivery matters, a recipe using `post-response` with a room id is
  the alternative.
- **Webhook exposure is the operator's job.** The runtime binds an
  HTTP server to the configured host and port. Putting that server on
  the public internet, behind TLS, or behind a tunnel is the
  operator's responsibility.

## When to use it

Webhook Notify is useful when an external system — a CI pipeline, a
monitoring service, a form — needs to reach a specific person and the
message is short and non-critical. It is also a reference for authors
writing recipes that consume webhooks: it shows how to chain
`webhook-receive`, `transform`, and an output primitive.
