import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { dispatch } from '../../src/cli/index.js'
import { createKeystore } from '../../src/runtime/keystore/index.js'

function makeIO (cwd, env, { captureBytes = false } = {}) {
  let out = ''
  const outBytes = []
  let err = ''
  return {
    stdout: {
      write: (chunk) => {
        if (captureBytes && typeof chunk !== 'string') {
          outBytes.push(Buffer.from(chunk))
        } else {
          out += String(chunk)
        }
      }
    },
    stderr: { write: (s) => { err += String(s) } },
    cwd,
    env,
    get out () { return out },
    get outBytes () { return Buffer.concat(outBytes) },
    get err () { return err }
  }
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

test('export-keys: 1. Missing keystore -> exit 1, "keystore not found"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys'], io)
    assert.equal(code, 1)
    assert.match(io.err, /keystore not found/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 2. A file that is not valid JSON -> exit 1, "not valid JSON"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    writeFileSync(ksPath, 'NOT-VALID-JSON{{{', 'utf8')
    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys'], io)
    assert.equal(code, 1)
    assert.match(io.err, /not valid JSON/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 3. A file that fails validateOuter -> exit 1, "malformed keystore"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    writeFileSync(ksPath, JSON.stringify({ version: 1, bot_id: 'b_test' }), 'utf8')
    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys'], io)
    assert.equal(code, 1)
    assert.match(io.err, /malformed keystore/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 4 & 5 & 6 & 10. --out <path> writes byte-identical keystore with mode 0o600 and stdout message', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    await writeKeystore(ksPath, 'test-secret')
    const originalBytes = readFileSync(ksPath)

    const outPath = join(tmp, 'exported.keystore')
    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys', '--out', outPath], io)
    assert.equal(code, 0)

    const exportedBytes = readFileSync(outPath)
    assert.deepEqual(exportedBytes, originalBytes)

    const stat = statSync(outPath)
    assert.equal(stat.mode & 0o777, 0o600)
    assert.match(io.out, new RegExp(`Exported keystore to ${outPath.replace(/\\/g, '\\\\')}\\.`))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 7. Existing destination without --force -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    await writeKeystore(ksPath, 'test-secret')

    const outPath = join(tmp, 'existing.keystore')
    writeFileSync(outPath, 'already-here', 'utf8')

    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys', '--out', outPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /destination already exists; pass --force to overwrite/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 8. Existing destination with --force overwrites', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    await writeKeystore(ksPath, 'test-secret')
    const originalBytes = readFileSync(ksPath)

    const outPath = join(tmp, 'existing.keystore')
    writeFileSync(outPath, 'already-here', 'utf8')

    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys', '--out', outPath, '--force'], io)
    assert.equal(code, 0)

    const exportedBytes = readFileSync(outPath)
    assert.deepEqual(exportedBytes, originalBytes)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 9. --out relative path resolves against io.cwd', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    await writeKeystore(ksPath, 'test-secret')
    const originalBytes = readFileSync(ksPath)

    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys', '--out', 'rel-exported.keystore'], io)
    assert.equal(code, 0)

    const resolvedOutPath = join(tmp, 'rel-exported.keystore')
    const exportedBytes = readFileSync(resolvedOutPath)
    assert.deepEqual(exportedBytes, originalBytes)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 11 & 12 & 13 & 14. No --out writes raw bytes to io.stdout, message to stderr, and empty out string', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    await writeKeystore(ksPath, 'test-secret')
    const originalBytes = readFileSync(ksPath)

    const io = makeIO(tmp, {}, { captureBytes: true })
    const code = await dispatch(['export-keys'], io)
    assert.equal(code, 0)

    assert.deepEqual(io.outBytes, originalBytes)
    assert.equal(io.out, '')
    assert.match(io.err, new RegExp(`Exported ${originalBytes.length} bytes to stdout\\.`))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 15. Read error on the source -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    writeFileSync(ksPath, '{}', 'utf8')
    chmodSync(ksPath, 0o000)

    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys'], io)
    assert.equal(code, 1)
    assert.match(io.err, /cannot read/)
  } finally {
    chmodSync(join(tmp, 'bot.keystore'), 0o600)
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 16. Write error on the destination -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    await writeKeystore(ksPath, 'test-secret')

    const readOnlyDir = join(tmp, 'readonly')
    mkdirSync(readOnlyDir)
    chmodSync(readOnlyDir, 0o500)

    const outPath = join(readOnlyDir, 'out.keystore')
    const io = makeIO(tmp, {})
    const code = await dispatch(['export-keys', '--out', outPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /cannot write/)
  } finally {
    chmodSync(join(tmp, 'readonly'), 0o700)
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 17. No ATOL_BOT_KEYSTORE_SECRET is required', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    await writeKeystore(ksPath, 'secret-phrase')

    const emptyEnv = {}
    const io = makeIO(tmp, emptyEnv, { captureBytes: true })
    const code = await dispatch(['export-keys'], io)
    assert.equal(code, 0)
    assert.equal(io.outBytes.length > 0, true)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('export-keys: 18. The subcommand does not call Keystore.load', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'exp-test-'))
  try {
    const ksPath = join(tmp, 'bot.keystore')
    await writeKeystore(ksPath, 'secret-phrase')

    const io = makeIO(tmp, { ATOL_BOT_KEYSTORE_SECRET: 'wrong-secret-that-would-fail-load' })
    const code = await dispatch(['export-keys', '--out', join(tmp, 'exported.keystore')], io)
    assert.equal(code, 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
