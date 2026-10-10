// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * All public typedefs for @atoll/recipes live in this file.
 * The file is a script: no imports, no exports, no runtime code.
 * Typedefs declared here are globally visible to downstream JSDoc.
 */

/* Primitives */

/**
 * A primitive is a verified, deterministic behavior. Primitives are
 * the only executable units in the system.
 * @typedef {object} Primitive
 * @property {string} id - Stable identifier, kebab-case.
 * @property {RecipeTarget[]} targets - Targets this primitive can
 *   be composed into. A recipe may only use primitives that include
 *   one of the recipe's targets.
 * @property {string[]} capabilities - Capabilities this primitive
 *   requires. The composer unions them into the artifact's
 *   declaration.
 * @property {string} label - Human-readable name.
 * @property {string} description - What the primitive does, one
 *   sentence.
 * @property {object} configSchema - JSON schema for the primitive's
 *   configuration.
 * @property {(config: Record<string, unknown>, children?: Handler[]) => Handler} create -
 *   Factory that takes the primitive's config and the resolved
 *   child handlers, and returns the primitive's handler.
 */

/**
 * A primitive instance inside a recipe composition.
 * @typedef {object} PrimitiveInstance
 * @property {string} id - Unique within the composition.
 * @property {string} primitive - The primitive's id.
 * @property {object} config - Config values. May reference slots as
 *   "{slotName}".
 * @property {PrimitiveInstance[]} [children] - Nested instances, when
 *   the primitive composes.
 */

/**
 * A handler is the runtime function a primitive produces. It
 * receives the bot's context and an input value, and returns an
 * output value or nothing. The composer wires handlers together by
 * passing a parent's output to a child's input.
 * @typedef {((ctx: unknown, input: unknown) => Promise<unknown>) | ((ctx: unknown, input: unknown) => unknown)} Handler
 */

/**
 * The mode of a keyed-store operation.
 * @typedef {'set' | 'get'} StoreMode
 */

/* Recipes */

/**
 * The runtime category of a recipe. Determines what the bot does
 * with requests.
 * @typedef {'pure' | 'assisted' | 'operated'} RecipeKind
 */

/**
 * The artifact a recipe produces.
 * @typedef {'bot' | 'extension'} RecipeTarget
 */

/**
 * A slot is a parameter the user fills in during the build flow.
 * @typedef {object} Slot
 * @property {string} name - Stable identifier, camelCase.
 * @property {'string' | 'number' | 'boolean' | 'select'} type -
 *   Value type.
 * @property {string} question - The question shown to the user.
 * @property {unknown} [default] - Default value when the user skips.
 * @property {string[]} [options] - Allowed values when type is
 *   'select'.
 * @property {string} [hint] - Short helper text.
 */

/**
 * A recipe is a declaration. No executable code.
 * @typedef {object} Recipe
 * @property {string} id - Stable identifier, kebab-case.
 * @property {string} version - Semver version string.
 * @property {string} label - Human-readable name.
 * @property {string} description - What the recipe builds.
 * @property {RecipeKind} kind - Runtime category.
 * @property {RecipeTarget[]} [targets] - Artifacts this recipe
 *   produces. Defaults to ['bot'] when omitted.
 * @property {string[]} capabilities - Capability ceiling. Must be a
 *   superset of the union of every composed primitive's required
 *   capabilities.
 * @property {import('@atoll/bot').SettingsDecl} [settings] -
 *   Runtime settings the operator configures after install,
 *   separate from build-time slots.
 * @property {Slot[]} slots - Parameters the user fills in.
 * @property {Record<string, PrimitiveInstance>} handlers - Handler
 *   map. Keys are handler names from the bot SDK.
 * @property {PrimitiveInstance[]} [triggers] - Trigger composition.
 * @property {string[]} [constraints] - What this recipe does not
 *   support.
 */

/* Intent and matching */

/**
 * A user's build request, as submitted to the engine.
 * @typedef {object} Intent
 * @property {string} text - The natural-language request.
 * @property {object} [context] - Non-identifying context, such as
 *   locale or a prior recipe in the same session.
 */

/**
 * A candidate match from the vector search.
 * @typedef {object} Candidate
 * @property {string} recipeId - The matched recipe.
 * @property {number} score - Similarity score, 0 to 1.
 */

/**
 * The result of matching an intent against the recipe library.
 * Either a match, a request for disambiguation, or a refusal.
 * @typedef {
 *   | { kind: 'match', recipeId: string, confidence: number,
 *       candidates: Candidate[] }
 *   | { kind: 'ambiguous', candidates: Candidate[] }
 *   | { kind: 'refusal', reason: string, suggestions: Candidate[] }
 * } MatchResult
 */

/**
 * Options for candidate ranking.
 * @typedef {object} RankOptions
 * @property {number} [threshold] - Minimum score for a candidate to
 *   be considered a match. Defaults to 0.55.
 * @property {number} [margin] - Minimum score gap between the top
 *   two candidates for a confident match. Defaults to 0.05.
 */

/**
 * An embedder turns text into a fixed-dimension vector. The same
 * text always produces the same vector.
 * @typedef {object} Embedder
 * @property {() => number} dimensions - The vector dimension this
 *   embedder produces.
 * @property {(text: string) => Promise<number[]>} embed - Returns
 *   the embedding for the given text.
 */

/**
 * Configuration for `createMatcher`.
 * @typedef {object} MatcherConfig
 * @property {Embedder} embedder - The embedder to use.
 * @property {object} index - The vector index. Must expose
 *   `search(query, k)`.
 * @property {object[]} recipes - Recipe summaries. Each carries at
 *   least an `id`; `label` and `description` are used during
 *   disambiguation.
 * @property {number} [topK] - Candidates to fetch from the index.
 *   Defaults to 10.
 * @property {RankOptions} [rankOptions] - Ranking options.
 * @property {(intent: string, candidates: Candidate[], recipes: object[]) =>
 *   Promise<MatchResult>} [disambiguator] - Resolves ambiguous
 *   results.
 */

/**
 * A matcher created by `createMatcher`.
 * @typedef {object} Matcher
 * @property {(intent: string) => Promise<MatchResult>} match -
 *   Matches an intent against the recipe library.
 */

/* Instantiation and output */

/**
 * A recipe plus filled slot values. The engine's input for
 * compilation.
 * @typedef {object} Instantiation
 * @property {string} recipeId - The recipe to instantiate.
 * @property {string} recipeVersion - The exact recipe version.
 * @property {Record<string, unknown>} slots - Slot values, keyed by
 *   slot name.
 */

/**
 * The canonical artifact definition. Data, not code. The primary
 * output of the composer. bot.js, or an extension module, is
 * emitted from a Composition.
 * @typedef {object} Composition
 * @property {string} recipeId - The recipe this was composed from.
 * @property {string} recipeVersion - The exact recipe version.
 * @property {RecipeTarget} target - The artifact this composition
 *   produces.
 * @property {Record<string, unknown>} slots - The slot values used.
 * @property {Record<string, PrimitiveInstance>} handlers - Resolved
 *   handler map, with slot references substituted.
 * @property {PrimitiveInstance[]} [triggers] - Resolved trigger
 *   composition.
 * @property {string[]} capabilities - The capabilities the artifact
 *   declares.
 * @property {import('@atoll/bot').SettingsDecl} [settings] - Runtime
 *   settings declarations, passed through from the recipe.
 */

/**
 * The emitted JavaScript source for a bot, plus its provenance.
 * @typedef {object} BotScript
 * @property {string} code - The generated bot.js source.
 * @property {Composition} composition - The Composition it was
 *   emitted from.
 */

/* Operator */

/**
 * How operators are bound to an operated recipe.
 * @typedef {'self' | 'room-member'} OperatorBinding
 */

/**
 * The runtime policy for an operated recipe.
 * @typedef {object} OperatorPolicy
 * @property {OperatorBinding[]} allowed - Binding options the user
 *   may choose.
 * @property {OperatorBinding} default - The binding used when the
 *   user does not choose.
 * @property {'never' | number} timeout - When a pending request
 *   expires. A number is seconds.
 * @property {'ignore' | 'canned'} onTimeout - What happens when a
 *   request times out.
 * @property {string} [cannedResponse] - Text sent when onTimeout is
 *   'canned'.
 */

/* Consent and telemetry */

/**
 * The consent tier for telemetry.
 * - 0: ephemeral, nothing persisted.
 * - 1: match result only, intent text discarded.
 * - 2: intent and match, used to train a classifier.
 * @typedef {0 | 1 | 2} ConsentTier
 */

/**
 * A single telemetry record, as persisted at consent tier 2.
 * @typedef {object} TelemetryRecord
 * @property {string} requestId - The request identifier.
 * @property {string} intentText - The user's intent text.
 * @property {string} matchedRecipe - The matched recipe id.
 * @property {number} matchConfidence - Confidence score, 0 to 1.
 * @property {Candidate[]} candidates - The candidate list returned.
 * @property {string} outcome - One of 'accepted', 'refused',
 *   'abandoned'.
 * @property {boolean} botRan - Whether the built bot has run
 *   successfully since the build.
 * @property {boolean} userFlagged - Whether the user flagged the
 *   result as wrong.
 * @property {string} engineVersion - The engine version that served
 *   the request.
 * @property {string} createdAt - ISO 8601 timestamp.
 */
