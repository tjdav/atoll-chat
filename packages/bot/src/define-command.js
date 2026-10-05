/**
 * Declares a command. `D` is inferred from the sibling `args`
 * property and flows into the handler's `args` parameter via
 * direct structured substitution.
 *
 * The handler's `ctx` parameter is not typed against the bot's
 * settings declaration. See §8.
 *
 * @template {Record<string, ArgDecl>} D - The argument declaration map.
 * @param {CommandDecl<D, any>} decl - The command declaration.
 * @returns {CommandDecl<D, any>} The same declaration, unchanged. The return exists for type inference.
 */
export function defineCommand (decl) {
  return decl
}
