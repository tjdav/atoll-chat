import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { dispatch } from '../../src/cli/index.js'

function makeIO (cwd) {
  let out = ''
  let err = ''
  return {
    stdout: {
      write: (s) => {
        out += s
        return true
      }
    },
    stderr: {
      write: (s) => {
        err += s
        return true
      }
    },
    cwd,
    get out () { return out },
    get err () { return err }
  }
}

const VALID_BOT_FIXTURE = `
export default {
  config: {
    id: "bot.rel",
    label: "My Valid Bot",
    hostApi: "1.0",
    capabilities: ["post_message"],
    handlers: {
      message: () => {}
    }
  }
};
`

test('1. No arguments prints usage to stderr and returns 1', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch([], io)
  assert.equal(code, 1)
  assert.match(io.err, /atoll-bot <command> \[options\]/)
})

test('2. --help prints usage to stdout and returns 0', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['--help'], io)
  assert.equal(code, 0)
  assert.match(io.out, /atoll-bot <command> \[options\]/)
})

test('3. -h behaves the same as --help', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['-h'], io)
  assert.equal(code, 0)
  assert.match(io.out, /atoll-bot <command> \[options\]/)
})

test('4. --version prints the version to stdout and returns 0', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['--version'], io)
  assert.equal(code, 0)
  assert.match(io.out, /@atoll\/bot \d+\.\d+\.\d+/)
})

test('5. -v behaves the same as --version', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['-v'], io)
  assert.equal(code, 0)
  assert.match(io.out, /@atoll\/bot \d+\.\d+\.\d+/)
})

test('6. Unknown command prints an error and usage to stderr, returns 1', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['unknowncmd'], io)
  assert.equal(code, 1)
  assert.match(io.err, /unknown command: unknowncmd/)
  assert.match(io.err, /atoll-bot <command> \[options\]/)
})

test('7. validate --help prints the validate usage and returns 0', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['validate', '--help'], io)
  assert.equal(code, 0)
  assert.equal(io.out.trim(), 'atoll-bot validate <path>')
})

test('8. validate -h behaves the same', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['validate', '-h'], io)
  assert.equal(code, 0)
  assert.equal(io.out.trim(), 'atoll-bot validate <path>')
})

test('9. Missing path argument returns 1 with an error', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['validate'], io)
  assert.equal(code, 1)
  assert.match(io.err, /validate requires a path to a bot file/)
})

test('10. Nonexistent file returns 1', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['validate', './nonexistent.js'], io)
  assert.equal(code, 1)
  assert.match(io.err, /not found/)
})

test('11. Relative path resolves against cwd', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(
      join(tmpDir, 'test-bot.js'),
      VALID_BOT_FIXTURE
    )
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './test-bot.js'], io)
    assert.equal(code, 0, io.err)
    assert.match(io.out, /OK: bot\.rel \(My Valid Bot\)/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('12. A file that throws at import returns 1 with a load error', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(join(tmpDir, 'syntax-err.js'), 'invalid syntax {{{')
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './syntax-err.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /failed to load/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('13. A file that does not export a default returns 1', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(join(tmpDir, 'no-default.js'), 'export const foo = 123;')
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './no-default.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /default export is not a Bot/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('14. A file whose default export is not an object returns 1', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(join(tmpDir, 'string-default.js'), 'export default "not a bot";')
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './string-default.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /default export is not a Bot/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('15. A file whose default export lacks a config field returns 1', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(join(tmpDir, 'no-config.js'), 'export default { foo: 1 };')
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './no-config.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /default export is not a Bot/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('16. A file whose config lacks an id returns 1', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(join(tmpDir, 'no-id.js'), 'export default { config: { label: "No ID" } };')
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './no-id.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /default export is not a Bot/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('17. A valid bot file returns 0 and prints OK: <id> (<label>)', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(
      join(tmpDir, 'valid.js'),
      VALID_BOT_FIXTURE
    )
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './valid.js'], io)
    assert.equal(code, 0, io.err)
    assert.equal(io.out.trim(), 'OK: bot.rel (My Valid Bot)')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('18. A bot with no label falls back to id in the output', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(
      join(tmpDir, 'nolabel.js'),
      `
      export default {
        config: {
          id: "bot.nolabel",
          hostApi: "1.0",
          capabilities: ["post_message"],
          handlers: {
            message: () => {}
          }
        }
      };
      `
    )
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './nolabel.js'], io)
    assert.equal(code, 0, io.err)
    assert.equal(io.out.trim(), 'OK: bot.nolabel (bot.nolabel)')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('19. defineBot was already called in the file and no re-validation error occurs', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(
      join(tmpDir, 'already-defined.js'),
      VALID_BOT_FIXTURE
    )
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './already-defined.js'], io)
    assert.equal(code, 0, io.err)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('20. A bot file that calls defineBot with an invalid config returns 1 during import', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(
      join(tmpDir, 'invalid-import.js'),
      'export default { config: { id: "INVALID ID HERE", handlers: {} } };'
    )
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './invalid-import.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /validation failed/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('21. A bot file that exports a plain invalid object returns 1 via re-validation', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(
      join(tmpDir, 'plain-invalid.js'),
      'export default { config: { id: "INVALID ID", handlers: {} } };'
    )
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './plain-invalid.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /validation failed/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('22. The validation failure message contains the failure list', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(
      join(tmpDir, 'plain-invalid-msg.js'),
      'export default { config: { id: "INVALID ID", handlers: {} } };'
    )
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './plain-invalid-msg.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /validation failed/)
    assert.match(io.err, /id:/)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('23. Success returns 0', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bot-cli-test-'))
  try {
    writeFileSync(
      join(tmpDir, 'ok.js'),
      VALID_BOT_FIXTURE
    )
    const io = makeIO(tmpDir)
    const code = await dispatch(['validate', './ok.js'], io)
    assert.equal(code, 0, io.err)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('24. User errors return 1', async () => {
  const io = makeIO(process.cwd())
  const code = await dispatch(['validate', './nonexistent.js'], io)
  assert.equal(code, 1)
})

test('25. Internal errors return 2', async () => {
  const io = makeIO(process.cwd())
  io.commands = {
    buggy: {
      usage: 'atoll-bot buggy',
      description: 'Buggy command',
      async run () {
        throw new Error('Unexpected catastrophe')
      }
    }
  }
  const code = await dispatch(['buggy'], io)
  assert.equal(code, 2)
  assert.match(io.err, /internal error: Unexpected catastrophe/)
})
