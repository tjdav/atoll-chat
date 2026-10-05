/**
 * Identity function. Shape-checked by the argument.
 *
 * @param {TriggerDecl} trigger - The trigger declaration.
 * @returns {TriggerDecl} The same declaration, unchanged. The return exists for type inference.
 */
export function defineTrigger (trigger) {
  return trigger
}
