// Type canary for the settings surface.
//
// Proves indexed-access extraction: `SettingValue<S[K]>` resolves each
// declared setting key to its value type, and unknown keys are rejected
// by the `K extends keyof S & string` constraint on `SettingsStore`.
//
// This file is type-checked, not executed. `tsc --noEmit` must pass.
// A `@ts-expect-error` annotation that goes unused is an error, so a
// passing typecheck proves each annotated line produced the expected
// type error.

import { defineSettings } from '../../src/define-settings.js'

const settings = defineSettings({
  apiToken: { label: 'API token', type: 'secret' },
  retries: { label: 'Retries', type: 'number' },
  enabled: { label: 'Enabled', type: 'boolean' },
  tags: { label: 'Tags', type: 'multiselect' }
})

// --- Positive: the declaration's own type literal is preserved ---
// If `defineSettings` widened the `type` field to `SettingKind`, these
// assignments would fail.
/** @type {'secret'} */
const tokenType = settings.apiToken.type
void tokenType

/** @type {'number'} */
const retriesType = settings.retries.type
void retriesType

// --- Positive: indexed-access extraction resolves each key's value ---
// A synthetic BotCtx<S> is constructed via cast. The runtime is not
// exercised; only the type surface is.
/** @type {BotCtx<typeof settings>} */
const ctx = /** @type {any} */ ({})

/** @type {Promise<string | undefined>} */
const tokenPromise = ctx.settings.get('apiToken')
void tokenPromise

/** @type {Promise<number | undefined>} */
const retriesPromise = ctx.settings.get('retries')
void retriesPromise

/** @type {Promise<boolean | undefined>} */
const enabledPromise = ctx.settings.get('enabled')
void enabledPromise

/** @type {Promise<string[] | undefined>} */
const tagsPromise = ctx.settings.get('tags')
void tagsPromise

// --- Negative: unknown key on get ---
// @ts-expect-error - 'nope' is not a declared setting key
ctx.settings.get('nope')

// --- Negative: wrong value type on set ---
// @ts-expect-error - apiToken expects a string, not a number
ctx.settings.set('apiToken', 42)

// --- Negative: unknown key on set ---
// @ts-expect-error - 'nope' is not a declared setting key
ctx.settings.set('nope', 'value')

export {}
