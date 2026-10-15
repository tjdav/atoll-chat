# The Tiered Pipeline

The intent pipeline that turns a user's plain-language intent into a
running bot. It has three tiers. Each is a fallback for the one above.

**Status: partial.** This document was reconstructed from the
`@atoll/recipes` chat contexts, the Chat A task sequence, and the
embedded spec slice in the A.2 handoff. Sections marked "to be
written" are not yet drafted. The six-check enumeration in §2.6 is
the operative text for Task A.2 and is quoted in full.

## 1. The three tiers

```
Intent
  │
  ├─► Tier 1 — Match
  │       ├── match or ambiguous ──► recipe path
  │       └── refusal ──► Tier 2
  │
  ├─► Tier 2 — Compose
  │       ├── composed ──► composed path
  │       └── refusal ──► Tier 3
  │
  └─► Tier 3 — Refuse
          └── refusal with classification and closest suggestions
```

### 1.1 Tier 1 — Match

The engine embeds the intent, searches a vector index of recipe
descriptions, ranks the candidates, and returns a `MatchResult`:
`match`, `ambiguous`, or `refusal`. The matched recipe is a verified
artifact. This tier is implemented. Its specification lives in
`packages/recipes/docs/spec.md`.

### 1.2 Tier 2 — Compose

When no recipe matches, the caller may invoke the composer. The
composer sends the intent, the primitive registry, and the recipe
summaries to an LLM. The LLM produces a `Composition`. The composition
is validated; if it fails, the composer retries once with the
validation error. If it fails again, the composer refuses. The
composer never writes JavaScript — it produces data; the compiler
emits code from the data.

This tier is in flight. Chat A implements it, task by task:

| Task | Purpose | Status |
|---|---|---|
| A.1 | Composition `source` field and emitter provenance | merged |
| A.2 | Composition validator | current |
| A.3 | Prompt builder | pending |
| A.4 | LLM wrapper | pending |
| A.5 | Composer entry | pending |
| A.6 | `/v1/compose` endpoint | pending |
| A.7 | Engine constructor wiring | pending |

### 1.3 Tier 3 — Refuse

When neither tier produces a usable result, the pipeline returns a
refusal. The refusal carries a reason, a human-readable message, and
the closest recipes as suggestions. The reason is one of
`no_primitive_covers`, `validation_failed`, `cost_exceeded`, or
`composer_unavailable`. The user sees an honest explanation, not a
fabricated bot.

### 1.4 The refusal shapes

To be written. The shape of each reason's `Refusal` record — field
names, the message convention, and how suggestions are ranked — is
not yet drafted.

## 2. The composer

### 2.1 The prompt

To be written. Task A.3 produces the prompt builder. This section will
carry the system prompt, the schema the LLM is asked to emit, and the
primitive/recipe summaries included in the prompt.

### 2.2 The LLM wrapper

To be written. Task A.4 produces the wrapper. This section will carry
the transport, the timeout policy, the cost accounting, and the
`composer_unavailable` mapping.

### 2.3 The composer entry

To be written. Task A.5 produces the entry. This section will carry
the composition freeze, the retry policy, and the refusal construction.

### 2.4 The composition freeze

To be written.

### 2.5 The retry policy

The composer validates each composition it produces. On validation
failure, it retries once, passing the validation error to the LLM. On
the second failure, it refuses with reason `validation_failed`. The
exact retry mechanics — whether the failed composition is echoed back
to the LLM, and in what form — are to be written alongside Task A.5.

### 2.6 The composition validator

Every Composition the composer produces is validated before it is
returned to the caller. The validation runs the same checks the recipe
validator runs, in the same order:

1. **Shape.** The Composition conforms to its type: `source`, `target`,
   `handlers`, `capabilities` present; `slots` is an object; `commands`
   and `triggers`, when present, are objects and arrays respectively.
2. **Primitives.** Every `PrimitiveInstance.primitive` resolves to a
   registered primitive for the composition's target.
3. **Config.** Every `PrimitiveInstance.config` conforms to the
   primitive's `configSchema`. Missing required fields, extra fields,
   and type mismatches all fail.
4. **Capabilities.** The union of every primitive's required
   capabilities is a subset of the composition's `capabilities`. A
   composition that declares a primitive requiring `post_message` but
   omits `post_message` from its ceiling fails.
5. **Templates.** Every `{slotName}` reference in a config resolves to
   a declared slot. Composed bots have no declared slots; a composed
   Composition that uses `{slotName}` fails.
6. **Names.** Every handler key is a name the SDK recognizes
   (`install`, `message`, `webhook`, `schedule`, `room`,
   `grantUpdated`, `uninstall`); every command key matches
   `^[a-z][a-z0-9-]*$` and its config's `name` matches the key.

On failure, the validator produces a structured error naming the
specific check and the offending field.

Task A.2 implements this section. The validator returns
`{ valid: true, composition }` on success or
`{ valid: false, errors: string[] }` on failure.

### 2.7 The `/v1/compose` endpoint

To be written. Task A.6 produces the endpoint. This section will carry
the request shape, the response shape, the error mapping, and the
relationship to `/v1/match` and `/v1/compile`.

## 3. The promotion pipeline

Deferred to v2. When the same composition shape recurs across users,
it becomes a promotion candidate. Promotion is human-gated: a
developer writes a recipe from the shape. Composed bots do not enter
the recipe library.

## 4. Open questions

- The retry policy's exact mechanics (§2.5).
- The refusal record's shape (§1.4).
- The prompt's schema (§2.1).

## 5. References

- The four artifacts: `packages/recipes/docs/spec.md`.
- The recipe format: `packages/recipes/docs/recipes.md`.
- The system overview: `packages/recipes/docs/bobtail-spec.md`.
- The Chat A context: `packages/recipes/docs/chat-a-context.md`.
