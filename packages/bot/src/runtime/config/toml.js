/**
 * Parses a TOML document into a nested object.
 *
 * The grammar is the strict subset documented in §1 of this task.
 * Section headers create one level of nesting. Values are typed by
 * their literal form. Unknown syntax is a parse error.
 *
 * @param {string} source - The TOML document text.
 * @returns {Record<string, Record<string, unknown>>} The parsed
 *   sections. Keys are section names; values are per-section maps of
 *   key to scalar.
 * @throws {Error} When the document does not conform to the grammar.
 *   The error's message names the offending line number and reason.
 */
export function parseToml (source) {
  if (typeof source !== 'string') {
    throw new TypeError('TOML source must be a string')
  }

  /** @type {Record<string, Record<string, unknown>>} */
  const result = {}
  let currentSection = null

  const lines = source.split(/\r?\n/)
  const sectionRegex = /^[A-Za-z0-9_-]+$/
  const keyRegex = /^[A-Za-z0-9_-]+$/

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex]
    if (rawLine === undefined) {
      continue
    }
    const lineNum = lineIndex + 1
    const trimmed = rawLine.trim()

    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue
    }

    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']')) {
        throw new Error(`Line ${lineNum}: Invalid section header "${trimmed}"`)
      }
      const sectionName = trimmed.slice(1, -1).trim()
      if (!sectionRegex.test(sectionName)) {
        throw new Error(`Line ${lineNum}: Invalid section name "${sectionName}"`)
      }
      currentSection = sectionName
      if (!Object.prototype.hasOwnProperty.call(result, currentSection)) {
        result[currentSection] = {}
      }
      continue
    }

    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) {
      throw new Error(`Line ${lineNum}: Invalid TOML syntax "${trimmed}"`)
    }

    const key = trimmed.slice(0, eqIdx).trim()
    if (!keyRegex.test(key)) {
      throw new Error(`Line ${lineNum}: Invalid key name "${key}"`)
    }

    if (currentSection === null) {
      throw new Error(`Line ${lineNum}: Key "${key}" specified before any section header`)
    }

    const sectionObj = result[currentSection]
    if (sectionObj === undefined) {
      throw new Error(`Line ${lineNum}: Section "${currentSection}" is undefined`)
    }

    if (Object.prototype.hasOwnProperty.call(sectionObj, key)) {
      throw new Error(`Line ${lineNum}: Duplicate key "${key}" in section "${currentSection}"`)
    }

    const valuePart = trimmed.slice(eqIdx + 1).trim()
    if (valuePart.length === 0) {
      throw new Error(`Line ${lineNum}: Missing value after =`)
    }

    if (valuePart.startsWith('"')) {
      const { value, endIdx } = parseStringLiteral(valuePart, lineNum)
      const remainder = valuePart.slice(endIdx).trim()
      if (remainder.length > 0 && !remainder.startsWith('#')) {
        throw new Error(`Line ${lineNum}: Unexpected trailing content after string value`)
      }
      sectionObj[key] = value
    } else {
      const commentIdx = valuePart.indexOf('#')
      const uncommented = commentIdx === -1 ? valuePart : valuePart.slice(0, commentIdx).trim()

      if (uncommented.length === 0) {
        throw new Error(`Line ${lineNum}: Missing value after =`)
      }

      if (uncommented === 'true') {
        sectionObj[key] = true
      } else if (uncommented === 'false') {
        sectionObj[key] = false
      } else if (/^[0-9]+$/.test(uncommented)) {
        sectionObj[key] = Number.parseInt(uncommented, 10)
      } else if (/^[0-9]+\.[0-9]+$/.test(uncommented)) {
        sectionObj[key] = Number.parseFloat(uncommented)
      } else {
        throw new Error(`Line ${lineNum}: Invalid value "${uncommented}"`)
      }
    }
  }

  return result
}

/**
 * Parses a double-quoted string literal.
 *
 * @param {string} str - The string starting with a double quote.
 * @param {number} lineNum - 1-based line number for error reporting.
 * @returns {{ value: string, endIdx: number }} The parsed string and the index after the closing quote.
 * @throws {Error} When the string is unterminated or contains invalid escapes.
 */
function parseStringLiteral (str, lineNum) {
  let result = ''
  let i = 1

  while (i < str.length) {
    const ch = str[i]
    if (ch === '"') {
      return {
        value: result,
        endIdx: i + 1
      }
    }
    if (ch === '\\') {
      if (i + 1 >= str.length) {
        throw new Error(`Line ${lineNum}: Unterminated escape sequence in string`)
      }
      const next = str[i + 1]
      if (next === '"') {
        result += '"'
      } else if (next === '\\') {
        result += '\\'
      } else if (next === 'n') {
        result += '\n'
      } else if (next === 't') {
        result += '\t'
      } else if (next === 'r') {
        result += '\r'
      } else {
        throw new Error(`Line ${lineNum}: Invalid escape sequence \\${next} in string`)
      }
      i += 2
    } else {
      result += ch
      i++
    }
  }

  throw new Error(`Line ${lineNum}: Unterminated string literal`)
}
