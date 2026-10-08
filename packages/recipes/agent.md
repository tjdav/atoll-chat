# @atoll/recipes — agent context

This file is read before every task. It is the persistent context.

## What this package is

`@atoll/recipes` is the engine that turns natural-language intent into a
running bot. It is a service, not a library. The instance sends it an
intent; it sends back a Composition. The instance compiles and runs it.

Three parts:
- The library: primitives and the recipe format.
- The compiler: Composition → bot.js.
- The service: the matcher (HTTP API) and the telemetry layer.

## Architecture — five invariants

1. The engine's output is a **Composition** (data), not bot.js (code).
   bot.js is emitted from a Composition, not the other way around.
2. **Primitives are the only executable units.** Recipes are declarative
   compositions. No recipe contains arbitrary code.
3. The **engine is a service.** The SaaS calls it over HTTP. The library
   is installed on the instance. Two entry points, one package.
4. The library is **AGPL-3.0, no CLA, no relicensing.** Every source
   file carries an SPDX header. No exception.
5. **Refusal is a first-class result.** The engine does not fabricate
   recipes. If nothing matches, it says so.

## Monorepo conventions

Lives at `packages/recipes/` alongside `packages/bot/`, `packages/app/`,
and `packages/extensions/`. Follow the same structure as `packages/bot/`.
That package is the reference.

## Coding standards

- Node.js ≥ 22.22.2, ESM.
- JavaScript with JSDoc. No TypeScript source.
- `node:test` for tests. `node:assert/strict`.
- Zero runtime dependencies. Dev dependencies only.
- All public JSDoc carries descriptions.
- Every @param, @returns, @property, and @template has a description
  after its type, separated by ` - ` (space, hyphen, space).

## Commands

- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test:canary` — canary suite (gates build)
- `pnpm test:unit` — unit tests
- `pnpm test:integration` — integration tests
- `pnpm test` — all three, in order
- `pnpm build` — emit .d.ts to dist/
- `pnpm validate` — lint + test + build
- `pnpm recipes verify <id>` — verify one recipe

## What not to do

- Do not add runtime dependencies. If needed, stop and report.
- Do not write code comments. Use JSDoc.
- Do not invent APIs. If a type is referenced and does not exist,
  stop and report.
- Do not modify files outside the paths in a task's Deliverables.
- Do not run `pnpm install` for new dependencies.
- Do not commit. The human commits.
- Do not modify `packages/bot/`, `packages/app/`, or
  `packages/extensions/`.
- Do not skip a task's Edge Cases section.
- Do not emit bot.js as the compiler's primary output. The primary
  output is a Composition.

## Where things live

- `docs/spec.md` — the engine specification
- `docs/tasks/` — task prompts, numbered, ordered
- `docs/inventory.md` — monorepo ground truth
- `src/types.js` — all JSDoc typedefs, no runtime
- `src/primitives/` — the primitive registry
- `src/recipe/` — recipe format (schema, loader, validator)
- `src/compiler/` — Composition → bot.js
- `src/server/` — the HTTP service
- `recipes/` — the recipe library (content)
- `tests/canary/` — must pass before build
- `tests/unit/` — unit tests
- `tests/integration/` — integration tests

## Task format

Every task has: Goal, Context, Deliverables, Steps, Edge cases,
Success criteria, Do not.

## When in doubt

Smaller is better. One artifact per task. If a task feels too large,
stop and propose a split in the task output.
