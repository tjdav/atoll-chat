/* eslint-disable jsdoc/no-undefined-types, jsdoc/require-param-description */

/**
 * Declares a command. `D` is inferred from the sibling `args`
 * property and flows into the handler's `args` parameter via
 * direct structured substitution.
 *
 * The handler's `ctx` parameter is not typed against the bot's
 * settings declaration. See §8.
 *
 * @template {Record<string, ArgDecl>} D
 * @param {CommandDecl<D, any>} decl
 * @returns {CommandDecl<D, any>}
 */
export function defineCommand (decl) {
  return decl
}
