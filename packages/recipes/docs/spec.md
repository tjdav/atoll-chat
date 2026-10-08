# @atoll/recipes Package Specification

Status: Draft — sections filled in as tasks require them.
License: AGPL-3.0, no CLA, no relicensing.
Location: `packages/recipes/` in the monorepo.

## 1. Overview

The engine that turns natural-language intent into a running bot. It is
a service. The instance sends an intent; the engine returns a
Composition. The instance compiles and runs it.

## 2. The four artifacts

| Artifact | Lives on | Produced by |
| --- | --- | --- |
| Recipe | The library | Community |
| Instantiation | Transient | The user (via UI) |
| Composition | The instance | The engine |
| Running bot | The instance | Atoll Chat runtime |

## 3. Package structure

```

packages/recipes/
├── src/
│   ├── index.js            public entry (library)
│   ├── types.js            JSDoc-only typedefs
│   ├── cli.js              atoll-recipes binary
│   ├── primitives/         the primitive registry
│   ├── recipe/             recipe format
│   ├── compiler/           Composition → bot.js
│   └── server/             HTTP service
├── recipes/                the recipe library (content)
├── tests/
│   ├── canary/
│   ├── unit/
│   └── integration/
└── docs/

```

## 4. Type surface

All public typedefs live in `src/types.js`. The file is a script: no
imports, no exports. Typedefs are grouped by domain.

## 5. Primitives

A primitive is a verified, deterministic behavior. Primitives are the
only executable units. A recipe composes primitives; it contains no
other code.

## 6. Recipe format

A recipe is a directory containing `recipe.json` (declaration) and
`recipe.md` (documentation). No executable code.

## 7. The matcher

Embedding search over the recipe library, then LLM disambiguation for
close candidates. Refusal is a first-class result.

## 8. The compiler

Takes an Instantiation, produces a Composition. Pure. Deterministic.
No network, no LLM.

## 9. The service

HTTP API: `/v1/match`, `/v1/compile`, `/v1/recipes`, `/v1/recipes/:id`.

## 10. Telemetry and consent

Three tiers: ephemeral (default), match result only, intent + match.
Opt-in. Preview shown before consent.

## 11. Verification

A recipe is verified when schema passes, primitives exist, config
validates, compile succeeds, and the generated artifact passes the
`@atoll/bot` canary.

## 12. Canaries

Three type-level canaries gate the build. Any change to the type
surface must keep them green.

## 13. Deferred

Specialized classifier, pattern layer, recipe marketplace,
multi-language recipe docs, signed recipes.

## 14. Open questions

To be resolved before implementation of the relevant section.
