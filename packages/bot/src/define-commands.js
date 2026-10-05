/**
 * Shape check for the commands collection. Per-command inference
 * lives in `defineCommand`, one level down. Do not attempt to
 * infer per-command types here - see the canary at
 * tests/canary/args.js for why.
 *
 * @template {Record<string, CommandDecl<any, any>>} C - The commands collection map.
 * @param {C} commands - The commands collection.
 * @returns {C} The same collection, unchanged. The return exists for type inference.
 */
export function defineCommands (commands) {
  return commands
}
