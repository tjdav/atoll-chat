import { ReplyRequiresReplyToError } from '../../errors.js'

/**
 * Creates the `ctx.reply` handler.
 *
 * `ctx.reply` is a validated wrapper over `ctx.post`. It rejects with
 * `ReplyRequiresReplyToError` when `opts.replyTo` is missing or empty,
 * then delegates to the post handler unchanged.
 *
 * @param {object} deps - The dependencies object.
 * @param {ReturnType<typeof import('./post.js').createPostHandler>} deps.post -
 *   The `ctx.post` handler. The wrapper calls it with the reply's
 *   options and the invocation context.
 * @param {import('../diagnostics/logger.js').Logger} [deps.logger] -
 *   Optional logger.
 * @returns {(opts: ReplyOptions, ctx: any) => Promise<MessageRef>} The reply handler.
 */
export function createReplyHandler ({ post, logger }) {
  return async function reply (opts, ctx) {
    const replyTo = opts?.replyTo
    if (typeof replyTo !== 'string' || replyTo.length === 0) {
      if (logger) {
        logger.debug('reply rejected: replyTo missing', {
          room_id: opts?.roomId ?? ctx?.grant?.roomId ?? null
        })
      }
      throw new ReplyRequiresReplyToError(
        'ctx.reply requires opts.replyTo to be a non-empty string'
      )
    }

    return post(opts, ctx)
  }
}
