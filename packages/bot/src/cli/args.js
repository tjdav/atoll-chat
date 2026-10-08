/**
 * Parses CLI arguments into positional arguments and flags.
 *
 * Long flags: `--name`, `--name value`, `--name=value`.
 * Short flags: `-n` (boolean only; no short-form values).
 * The `--` terminator makes every subsequent argument positional.
 *
 * @param {string[]} argv - Arguments after the program name. For
 *   example, `process.argv.slice(2)`.
 * @returns {{ positional: string[], flags: Record<string, string | true> }} -
 *   The parsed positional arguments and flags. A flag with no value is
 *   `true`.
 */
export function parseArgs (argv) {
  /** @type {string[]} */
  const positional = []
  /** @type {Record<string, string | true>} */
  const flags = {}
  let inPositionalsOnly = false

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === undefined) {
      continue
    }

    if (inPositionalsOnly) {
      positional.push(token)
      continue
    }

    if (token === '--') {
      inPositionalsOnly = true
      continue
    }

    if (token === '-') {
      positional.push(token)
      continue
    }

    if (token.startsWith('--')) {
      const eqIndex = token.indexOf('=')
      if (eqIndex !== -1) {
        const key = token.slice(2, eqIndex)
        const val = token.slice(eqIndex + 1)
        flags[key] = val
      } else {
        const key = token.slice(2)
        const nextToken = argv[i + 1]
        if (nextToken !== undefined && !nextToken.startsWith('-')) {
          flags[key] = nextToken
          i++
        } else if (nextToken !== undefined && nextToken.startsWith('-') && !nextToken.startsWith('--')) {
          flags[key] = true
          positional.push(nextToken)
          i++
        } else {
          flags[key] = true
        }
      }
      continue
    }

    if (token.startsWith('-')) {
      const key = token.slice(1)
      flags[key] = true
      continue
    }

    positional.push(token)
  }

  return {
    positional,
    flags
  }
}
