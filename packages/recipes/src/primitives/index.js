// SPDX-License-Identifier: AGPL-3.0-or-later

import { postResponse } from './post-response.js'
import { sendLocal } from './send-local.js'
import { watchPattern } from './watch-pattern.js'
import { keyedStore } from './keyed-store.js'
import { exposeCommand } from './expose-command.js'
import { scheduleTask } from './schedule-task.js'
import { webhookReceive } from './webhook-receive.js'
import { httpFetch } from './http-fetch.js'
import { settingsRead } from './settings-read.js'
import { settingsWrite } from './settings-write.js'
import { transform } from './transform.js'
import { queueForOperator } from './queue-for-operator.js'
import { llmComplete } from './llm-complete.js'

/**
 * The primitive registry. Keyed by target, then by primitive id.
 * Only the 'bot' target is populated in v1. The 'extension' key
 * exists so that adding extension primitives later does not require
 * restructuring the registry.
 * @type {Record<RecipeTarget, Record<string, Primitive>>}
 */
export const primitives = {
  bot: {
    [postResponse.id]: postResponse,
    [sendLocal.id]: sendLocal,
    [watchPattern.id]: watchPattern,
    [keyedStore.id]: keyedStore,
    [exposeCommand.id]: exposeCommand,
    [scheduleTask.id]: scheduleTask,
    [webhookReceive.id]: webhookReceive,
    [httpFetch.id]: httpFetch,
    [settingsRead.id]: settingsRead,
    [settingsWrite.id]: settingsWrite,
    [transform.id]: transform,
    [queueForOperator.id]: queueForOperator
    [llmComplete.id]: llmComplete
  },
  extension: {}
}

/**
 * Returns the primitive registered for a target and id, or
 * undefined when no primitive matches.
 * @param {RecipeTarget} target - The target registry to search.
 * @param {string} id - The primitive id.
 * @returns {Primitive | undefined} The primitive, or undefined.
 */
export function getPrimitive (target, id) {
  const registry = primitives[target]
  if (!registry) {
    return undefined
  }
  return registry[id]
}

/**
 * Returns the sorted list of primitive ids registered for a target.
 * @param {RecipeTarget} target - The target registry to list.
 * @returns {string[]} The primitive ids, sorted alphabetically.
 */
export function listPrimitives (target) {
  const registry = primitives[target]
  if (!registry) {
    return []
  }
  return Object.keys(registry).sort()
}
