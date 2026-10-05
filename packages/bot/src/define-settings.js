/**
 * Declares a bot's settings. Property names become setting keys.
 * The constraint on `Ds` preserves the `type` literals so that
 * `ctx.settings.get('apiToken')` resolves to `string`.
 *
 * @template {Record<string, SettingDecl>} Ds - The settings declaration map.
 * @param {Ds} decls - The settings declaration map. Keys are author-chosen setting names.
 * @returns {Ds} The same declaration map, unchanged. The return exists for type inference.
 */
export function defineSettings (decls) {
  return decls
}
