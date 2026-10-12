// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  asCommandDecl,
  postResponse,
  sendLocal,
  replyLocal,
  watchPattern,
  keyedStore,
  exposeCommand,
  scheduleTask,
  webhookReceive,
  httpFetch,
  settingsRead,
  settingsWrite,
  transform
} from '../../../../src/primitives/entry.js'

/**
 * Loads an emitted bot.js source string against the real primitives
 * and a mock context. The emitted code's imports are stripped; the
 * real primitives are passed in by name. Only `defineBot` is stubbed.
 *
 * @param {string} code - The emitted bot.js source.
 * @param {object} [options] - Load options.
 * @param {object | null} [options.room] - The mock `ctx.room`.
 *   Defaults to a synthetic room. Pass `null` to omit it.
 * @param {Record<string, unknown>} [options.storage] - Initial
 *   storage values.
 * @param {Record<string, unknown>} [options.settings] - Initial
 *   settings values. User scope: plain keys. Room scope:
 *   `room:<roomId>:<key>`.
 * @param {Record<string, object>} [options.responses] - URL → Response
 *   map for `ctx.fetch`. A URL not in the map throws.
 * @returns {{ config: object, ctx: object, posts: object[], locals: object[], fetches: object[], storage: Map<string, unknown>, settings: Map<string, unknown> }} The loaded bot and its records.
 */
export function loadEmittedBot (code, options) {
  const opts = options === undefined ? {} : options
  const posts = []
  const locals = []
  const fetches = []

  const storage = new Map(Object.entries(opts.storage ?? {}))
  const settings = new Map(Object.entries(opts.settings ?? {}))

  const room = opts.room === undefined
    ? { id: 'r_default', displayName: 'Room', memberCount: 1 }
    : opts.room

  const ctx = {
    room,
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => { storage.set(key, value) },
      delete: async (key) => { storage.delete(key) },
      clear: async () => { storage.clear() }
    },
    settings: {
      get: async (key, storeOpts) => {
        if (storeOpts && typeof storeOpts.room === 'string') {
          return settings.get(`room:${storeOpts.room}:${key}`)
        }
        return settings.get(key)
      },
      set: async (key, value, storeOpts) => {
        if (storeOpts && typeof storeOpts.room === 'string') {
          settings.set(`room:${storeOpts.room}:${key}`, value)
        } else {
          settings.set(key, value)
        }
      },
      delete: async (key, storeOpts) => {
        if (storeOpts && typeof storeOpts.room === 'string') {
          settings.delete(`room:${storeOpts.room}:${key}`)
        } else {
          settings.delete(key)
        }
      }
    },
    post: async (opts2) => {
      posts.push(opts2)
      return { id: 'm_generated', roomId: opts2.roomId, createdAt: '2026-01-01T00:00:00Z' }
    },
    sendLocal: async (opts2) => {
      locals.push(opts2)
    },
    fetch: async (url, init) => {
      fetches.push({ url, init })
      const response = (opts.responses ?? {})[url]
      if (response === undefined) {
        throw new Error(`loadEmittedBot: no mock response for ${url}`)
      }
      return response
    },
    log: () => {},
    signal: new AbortController().signal
  }

  const defineBot = (config) => config

  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const buildFn = () => {
    const src = Buffer.from(encoded, 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \{[\s\S]*?\} from '@atoll\/bot'/, '')
      .replace(/import \{[\s\S]*?\} from '@atoll\/recipes\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function(
      'defineBot',
      'asCommandDecl',
      'postResponse',
      'sendLocal',
      'replyLocal',
      'watchPattern',
      'keyedStore',
      'exposeCommand',
      'scheduleTask',
      'webhookReceive',
      'httpFetch',
      'settingsRead',
      'settingsWrite',
      'transform',
      cleaned
    )
    return fn(
      defineBot,
      asCommandDecl,
      postResponse,
      sendLocal,
      replyLocal,
      watchPattern,
      keyedStore,
      exposeCommand,
      scheduleTask,
      webhookReceive,
      httpFetch,
      settingsRead,
      settingsWrite,
      transform
    )
  }

  const config = buildFn()
  return { config, ctx, posts, locals, fetches, storage, settings }
}
