// Type canary for the command args surface.
//
// Proves sibling-contextual substitution: the `args` property of a
// `defineCommand` call is inferred as the template parameter `D`, and
// `D` flows into the handler's second parameter via `ArgsReader<D>`.
// Unknown argument names are rejected by `K extends keyof D & string`.
// Unknown argument kinds are rejected by the `ArgKind` union.
//
// This file is type-checked, not executed. `tsc --noEmit` must pass.
// A `@ts-expect-error` annotation that goes unused is an error, so a
// passing typecheck proves each annotated line produced the expected
// type error.

import { defineCommand } from '../../src/define-command.js'

// --- Positive: required args are non-optional; optional args are
// possibly undefined; each key resolves to its declared value type ---
defineCommand({
  description: 'Canary command',
  args: {
    query: { type: 'string', required: true },
    limit: { type: 'number' },
    strict: { type: 'boolean' },
    sort: { type: 'select', options: ['asc', 'desc'] }
  },
  handler: async (ctx, args) => {
    // Required: string, not string | undefined
    /** @type {string} */
    const query = args.get('query')
    void query

    // Optional: number | undefined
    /** @type {number | undefined} */
    const limit = args.get('limit')
    void limit

    // Optional: boolean | undefined
    /** @type {boolean | undefined} */
    const strict = args.get('strict')
    void strict

    // Optional select: string | undefined
    /** @type {string | undefined} */
    const sort = args.get('sort')
    void sort

    // Negative: unknown argument name
    // @ts-expect-error - 'nope' is not a declared argument
    args.get('nope')

    void ctx
    return { type: 'none' }
  }
})

// --- Negative: unknown argument kind ---
// A standalone malformed ArgDecl is rejected by the typechecker.
/** @type {ArgDecl} */
const badArg = {
  // @ts-expect-error - 'banana' is not an ArgKind
  type: 'banana'
}
void badArg

export {}
