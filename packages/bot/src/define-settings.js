/* eslint-disable jsdoc/no-undefined-types, jsdoc/require-param-description */

/**
 * Declares a bot's settings. Property names become setting keys.
 * The constraint on `Ds` preserves the `type` literals so that
 * `ctx.settings.get('apiToken')` resolves to `string`.
 *
 * @template {Record<string, SettingDecl>} Ds
 * @param {Ds} decls
 * @returns {Ds}
 */
export function defineSettings (decls) {
  return decls
}
