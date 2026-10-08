import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { dispatch } from '../../src/cli/index.js'
import { createKeystore } from '../../src/runtime/keystore/index.js'

function makeIO (cwd, env, overrides = {}) {
  let out = ''
  let err = ''
  return {
    stdout: { write: (s) => { out += String(s) } },
    stderr: { write: (s) => { err += String(s) } },
    cwd,
    env,
    get out () { return out },
    get err () { return err },
    ...overrides
  }
}

function makeStdin (bytes) {
  return Readable.from([bytes])
}

async function writeKeystore (path, secret, botId = 'b_test') {
  await createKeystore({
    path,
    secret,
    data: {
      version: 1,
      bot_id: botId,
      bot_token: 'bot-token',
      bot_identity_private: Buffer.alloc(32, 0x11).toString('base64url'),
      bot_command_private: Buffer.alloc(32, 0x22).toString('base64url'),
      identity_private: Buffer.alloc(32, 0x33).toString('base64url'),
      storage_seed: Buffer.alloc(32, 0x44).toString('base64url'),
      operator_session: 'session-token',
      created_at: new Date(0).toISOString(),
      rotated_at: new Date(0).toISOString()
    }
  })
}

test('import-keys: 1. Missing path argument -> exit 1, "requires a path"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys'], io)
    assert.equal(code, 1)
    assert.match(io.err, /import-keys requires a path/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 2. Nonexistent source -> exit 1, "file not found"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', join(tmp, 'nonexistent.ks')], io)
    assert.equal(code, 1)
    assert.match(io.err, /file not found/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 3. Source file not valid JSON -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'bad.ks')
    writeFileSync(srcPath, 'INVALID-JSON-TEXT', 'utf8')
    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /source is not valid JSON/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 4. Source file fails validateOuter -> exit 1, message mentions reason', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'bad-outer.ks')
    writeFileSync(srcPath, JSON.stringify({ version: 1, bot_id: 'b_imp' }), 'utf8')
    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /source is not a valid keystore: outer salt must be a 16-byte base64url string/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 5 & 6 & 7. Valid source writes byte-identical keystore to target path with mode 0o600', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-1', 'b_valid')
    const sourceBytes = readFileSync(srcPath)

    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 0)

    const targetPath = join(tmp, 'bot.keystore')
    const writtenBytes = readFileSync(targetPath)
    assert.deepEqual(writtenBytes, sourceBytes)

    const stat = statSync(targetPath)
    assert.equal(stat.mode & 0o777, 0o600)
    assert.match(io.out, /Imported keystore for bot b_valid\./)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 8. Existing keystore without --force -> exit 1, "already exists"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-1', 'b_exist')

    const targetPath = join(tmp, 'bot.keystore')
    writeFileSync(targetPath, 'existing-content', 'utf8')

    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /keystore already exists; pass --force to overwrite/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 9. Existing keystore with --force overwrites', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-1', 'b_force')
    const sourceBytes = readFileSync(srcPath)

    const targetPath = join(tmp, 'bot.keystore')
    writeFileSync(targetPath, 'existing-content', 'utf8')

    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', srcPath, '--force'], io)
    assert.equal(code, 0)

    const writtenBytes = readFileSync(targetPath)
    assert.deepEqual(writtenBytes, sourceBytes)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 10. A relative source path resolves against io.cwd', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const relSrcName = 'rel-source.keystore'
    const absSrcPath = join(tmp, relSrcName)
    await writeKeystore(absSrcPath, 'secret-1', 'b_rel')
    const sourceBytes = readFileSync(absSrcPath)

    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', relSrcName], io)
    assert.equal(code, 0)

    const targetPath = join(tmp, 'bot.keystore')
    const writtenBytes = readFileSync(targetPath)
    assert.deepEqual(writtenBytes, sourceBytes)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 11. ATOL_BOT_KEYSTORE env var controls target path', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-1', 'b_env')
    const sourceBytes = readFileSync(srcPath)

    const customPath = join(tmp, 'custom', 'my-bot.keystore')
    mkdirSync(join(tmp, 'custom'))

    const io = makeIO(tmp, { ATOL_BOT_KEYSTORE: customPath })
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 0)

    const writtenBytes = readFileSync(customPath)
    assert.deepEqual(writtenBytes, sourceBytes)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 12. Default target path (<cwd>/bot.keystore) is used when env var is unset', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-1', 'b_def')

    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 0)

    const defaultPath = join(tmp, 'bot.keystore')
    assert.equal(statSync(defaultPath).isFile(), true)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 13 & 14. "-" reads from io.stdin and writes to target', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-1', 'b_stdin')
    const sourceBytes = readFileSync(srcPath)

    const io = makeIO(tmp, {}, { stdin: makeStdin(sourceBytes) })
    const code = await dispatch(['import-keys', '-'], io)
    assert.equal(code, 0)

    const targetPath = join(tmp, 'bot.keystore')
    const writtenBytes = readFileSync(targetPath)
    assert.deepEqual(writtenBytes, sourceBytes)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 15. Missing io.stdin -> exit 1, message mentions stdin', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', '-'], io)
    assert.equal(code, 1)
    assert.match(io.err, /import-keys from stdin requires an io\.stdin stream/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 16. Empty stdin -> exit 1, "source is not valid JSON"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const io = makeIO(tmp, {}, { stdin: makeStdin(Buffer.alloc(0)) })
    const code = await dispatch(['import-keys', '-'], io)
    assert.equal(code, 1)
    assert.match(io.err, /source is not valid JSON/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 17. Read error on the source -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'unreadable.ks')
    writeFileSync(srcPath, 'content', 'utf8')
    chmodSync(srcPath, 0o000)

    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /cannot read/)
  } finally {
    chmodSync(join(tmp, 'unreadable.ks'), 0o600)
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 18. Write error on the target -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-1', 'b_writeerr')

    const readOnlyDir = join(tmp, 'readonly')
    mkdirSync(readOnlyDir)
    chmodSync(readOnlyDir, 0o500)

    const targetPath = join(readOnlyDir, 'bot.keystore')
    const io = makeIO(tmp, { ATOL_BOT_KEYSTORE: targetPath })
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /cannot write/)
  } finally {
    chmodSync(join(tmp, 'readonly'), 0o700)
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 19. No ATOL_BOT_KEYSTORE_SECRET is required', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-phrase', 'b_nosecret')

    const io = makeIO(tmp, {})
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 20. The subcommand does not call Keystore.load', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const srcPath = join(tmp, 'source.keystore')
    await writeKeystore(srcPath, 'secret-phrase', 'b_noload')

    const io = makeIO(tmp, { ATOL_BOT_KEYSTORE_SECRET: 'wrong-secret' })
    const code = await dispatch(['import-keys', srcPath], io)
    assert.equal(code, 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('import-keys: 21 & 22. export-keys --out followed by import-keys --force produces byte-identical keystore and preserves bot_id', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'imp-test-'))
  try {
    const originalKsPath = join(tmp, 'bot.keystore')
    await writeKeystore(originalKsPath, 'orig-secret', 'b_roundtrip')
    const originalBytes = readFileSync(originalKsPath)

    const exportPath = join(tmp, 'exported.keystore')
    const ioExport = makeIO(tmp, {})
    const expCode = await dispatch(['export-keys', '--out', exportPath], ioExport)
    assert.equal(expCode, 0)

    const ioImport = makeIO(tmp, {})
    const impCode = await dispatch(['import-keys', exportPath, '--force'], ioImport)
    assert.equal(impCode, 0)

    const importedBytes = readFileSync(originalKsPath)
    assert.deepEqual(importedBytes, originalBytes)

    const parsed = JSON.parse(importedBytes.toString('utf8'))
    assert.equal(parsed.bot_id, 'b_roundtrip')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
