import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { readLatestState, resolveDiagPath } from './diag-file.js'
import { UserError } from './index.js'

/**
 * The `inspect` subcommand.
 *
 * Reads the diagnostic file's most recent state snapshot and prints
 * it. When a room id is provided, prints only that room's slice of
 * the state.
 *
 * @type {import('./index.js').Subcommand}
 */
export const inspectCommand = {
  usage: 'atoll-bot inspect [room-id]',
  description: 'Dump the running bot\'s state',
  async run (args, flags, io) {
    const env = io.env ?? process.env
    const cwd = io.cwd ?? process.cwd()

    const keystorePath = env.ATOL_BOT_KEYSTORE
      ? resolve(cwd, env.ATOL_BOT_KEYSTORE)
      : resolve(cwd, 'bot.keystore')

    const diagPath = resolveDiagPath(keystorePath)

    try {
      statSync(diagPath)
    } catch {
      throw new UserError(`${diagPath}: diagnostic file not found; is the bot running?`)
    }

    const state = await readLatestState(diagPath)
    if (!state) {
      throw new UserError(`${diagPath}: no state snapshot found`)
    }

    const roomId = args[0]
    const data = (state.data && typeof state.data === 'object')
      ? /** @type {Record<string, any>} */ (state.data)
      : {}

    let outputData = data

    if (roomId) {
      const grants = data.grants && typeof data.grants === 'object' ? data.grants : {}
      const publisherKeys = data.publisher_keys && typeof data.publisher_keys === 'object' ? data.publisher_keys : {}

      const roomGrant = grants[roomId]
      const roomPubKeys = publisherKeys[roomId]

      if (!roomGrant && !roomPubKeys) {
        throw new UserError(`room ${roomId} not found in the state snapshot`)
      }

      outputData = {
        bot_id: data.bot_id,
        now: data.now,
        grants: roomGrant ? { [roomId]: roomGrant } : {},
        publisher_keys: roomPubKeys ? { [roomId]: roomPubKeys } : {}
      }
    }

    const atStr = state.at ?? data.now ?? new Date().toISOString()
    io.stdout.write(`Snapshot at ${atStr}\n${JSON.stringify(outputData, null, 2)}\n`)
    return 0
  }
}
