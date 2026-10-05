/* eslint-disable jsdoc/no-undefined-types, jsdoc/require-param-description */

/**
 * Shape check for the commands collection. Per-command inference
 * lives in `defineCommand`, one level down. Do not attempt to
 * infer per-command types here — see the canary at
 * tests/canary/args.js for why.
 *
 * @template {Record<string, CommandDecl<any, any>>} C
 * @param {C} commands
 * @returns {C}
 */
export function defineCommands (commands) {
  return commands
}
