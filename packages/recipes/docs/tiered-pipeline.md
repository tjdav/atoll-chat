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

Refusals signal that the pipeline could not produce a usable artifact for the given intent. The matcher and composer tiers return structured refusal records distinguished by `kind: 'refusal'`.

The matcher produces refusals with reason `No candidate matches with sufficient confidence.` and carries candidate suggestions:
```js
{ kind: 'refusal', reason: string, suggestions: Candidate[] }
```

The composer produces refusals with a `reason` discriminant, a short human-readable `message`, and optional second-attempt validation `errors`:
```js
{ kind: 'refusal', reason: string, message: string, errors?: CompositionValidationError[] }
```

The composer produces strictly two refusal reasons:
- `composer_unavailable`: The LLM transport failed at the wire (network error, timeout, HTTP error status, or malformed/unparseable response structure) on attempt 1 or attempt 2.
- `validation_failed`: The LLM produced content that failed Composition validation twice, or produced unparseable JSON content on the second attempt.

Higher pipeline layers (such as the matcher or SaaS cost gates) produce `no_primitive_covers` and `cost_exceeded`. The `/v1/compose` endpoint (Task A.6) projects composer results directly onto HTTP response objects.

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

The entry point `composeBot(intent, options)` in `packages/recipes/src/composer/compose.js` connects the prompt builder (`packages/recipes/src/composer/prompt.js`), LLM wrapper (`packages/recipes/src/composer/llm.js`), and Composition validator (`packages/recipes/src/composer/validate.js`).

`composeBot` accepts a natural-language intent string and an options object containing the primitive registry, recipe library, and LLM configuration options (`upstreamUrl`, `apiKey`, `model`, optional `fetch`, `timeoutMs`, `temperature`). It returns a Promise resolving to `ComposeBotResult`:
```js
{ kind: 'composed', composition: Composition }
| { kind: 'refusal', reason: string, message: string, errors?: CompositionValidationError[] }
```

The function executes at most two LLM attempts. It does not perform JavaScript code emission (`bot.js`); emission is handled separately by the compiler (`packages/recipes/src/compiler/emit.js`) when invoked by the endpoint layer.

### 2.4 The composition freeze

Before returning a successful `{ kind: 'composed', composition }` result, `composeBot` deep-freezes the returned `Composition` object and every nested property (`slots`, `handlers`, `commands`, `triggers`, `capabilities`, `settings`, and primitive instances) using `Object.freeze`.

The composition is a validated, deterministic artifact; freezing guarantees immutability across downstream compiler and endpoint processing. Deep freeze is strictly in-memory and non-durable; no disk persistence or hashing is performed at this layer.

### 2.5 The retry policy

The composer validates every generated composition against §2.6 using `validateComposition`.

If the first attempt fails validation, `composeBot` retries exactly once. The retry prompt carries the intent and the first attempt's validation errors as a structured list (`- [code] path: message`). The prior invalid Composition object is **not echoed back** to the LLM, keeping the retry prompt concise and focused on correction requirements.

If the first LLM call returns `invalid_json_content` (content that cannot be parsed as JSON), it is treated as a validation failure and retried with a synthetic error `Response content is not valid JSON`.

If the second attempt also fails validation or returns `invalid_json_content`, `composeBot` terminates retry recursion and returns a refusal with reason `validation_failed`, carrying the second attempt's validation errors in `errors`.

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
