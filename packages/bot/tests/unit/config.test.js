import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadConfig } from '../../src/runtime/config/index.js';

describe('Config loader unit tests', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-config-test-'));
  });

  afterEach(async () => {
    if (tmpDir !== '') {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('1. No env, no TOML -> all defaults', async () => {
    const config = await loadConfig({ env: {}, cwd: tmpDir });

    assert.equal(config.botToken, undefined);
    assert.equal(config.serverUrl, undefined);
    assert.equal(config.keystoreSecret, undefined);
    assert.equal(config.userToken, undefined);
    assert.equal(config.handlerTimeoutMs, 60000);

    assert.equal(config.runtime.logLevel, 'info');
    assert.equal(config.runtime.logFormat, 'json');

    assert.equal(config.webhook.host, '0.0.0.0');
    assert.equal(config.webhook.port, 8787);
    assert.equal(config.webhook.basePath, '');
    assert.equal(config.webhook.maxBodyBytes, 1048576);
    assert.equal(config.webhook.timeoutMs, 5000);

    assert.equal(config.cron.timezone, 'UTC');
    assert.equal(config.cron.catchUp, false);

    assert.equal(config.reconnect.baseBackoffMs, 1000);
    assert.equal(config.reconnect.maxBackoffMs, 30000);
    assert.equal(config.reconnect.jitter, 0.2);

    assert.equal(config.shutdown.drainMs, 30000);

    assert.equal(config.diagnostics.enabled, true);
    assert.equal(config.diagnostics.retentionDays, 7);

    assert.equal(config.botConfigPath, path.resolve(tmpDir, 'bot.toml'));
    assert.equal(config.keystorePath, path.resolve(tmpDir, 'bot.keystore'));
  });

  it('2. Only env -> env values override defaults', async () => {
    const env = {
      ATOL_LOG_LEVEL: 'warn',
      ATOL_BOT_PORT: '9999'
    };
    const config = await loadConfig({ env, cwd: tmpDir });

    assert.equal(config.runtime.logLevel, 'warn');
    assert.equal(config.webhook.port, 9999);
  });

  it('3. Only TOML -> TOML values override defaults', async () => {
    const tomlContent = `
[runtime]
log_level = "debug"

[webhook]
port = 1234
`;
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), tomlContent, 'utf8');

    const config = await loadConfig({ env: {}, cwd: tmpDir });

    assert.equal(config.runtime.logLevel, 'debug');
    assert.equal(config.webhook.port, 1234);
  });

  it('4. Both env and TOML -> env wins', async () => {
    const tomlContent = `
[runtime]
log_level = "debug"
`;
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), tomlContent, 'utf8');

    const env = {
      ATOL_LOG_LEVEL: 'warn'
    };
    const config = await loadConfig({ env, cwd: tmpDir });

    assert.equal(config.runtime.logLevel, 'warn');
  });

  it('5. TOML-only fields respect TOML', async () => {
    const tomlContent = `
[cron]
catch_up = true
`;
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), tomlContent, 'utf8');

    const config = await loadConfig({ env: {}, cwd: tmpDir });

    assert.equal(config.cron.catchUp, true);
  });

  it('6. Explicit config path missing -> error', async () => {
    const missingPath = path.join(tmpDir, 'does-not-exist.toml');
    const env = {
      ATOL_BOT_CONFIG: missingPath
    };

    await assert.rejects(
      () => loadConfig({ env, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Config file explicitly specified by ATOL_BOT_CONFIG not found/);
        assert.match(e.message, new RegExp(missingPath.replace(/\\/g, '\\\\')));
        return true;
      }
    );
  });

  it('7. Default config path missing -> defaults', async () => {
    const config = await loadConfig({ env: {}, cwd: tmpDir });
    assert.equal(config.runtime.logLevel, 'info');
  });

  it('8. Malformed TOML -> error', async () => {
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), '[runtime', 'utf8');

    await assert.rejects(
      () => loadConfig({ env: {}, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Invalid section header/);
        return true;
      }
    );
  });

  it('9. Unknown section -> error', async () => {
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), '[webhoook]\nport = 8080', 'utf8');

    await assert.rejects(
      () => loadConfig({ env: {}, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Unknown TOML section \[webhoook\]/);
        return true;
      }
    );
  });

  it('10. Unknown key -> error', async () => {
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), '[webhook]\nprt = 8080', 'utf8');

    await assert.rejects(
      () => loadConfig({ env: {}, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Unknown key "prt" in TOML section \[webhook\]/);
        return true;
      }
    );
  });

  it('11. Invalid log level -> error', async () => {
    const env = {
      ATOL_LOG_LEVEL: 'trace'
    };

    await assert.rejects(
      () => loadConfig({ env, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Invalid runtime\.logLevel "trace"/);
        return true;
      }
    );
  });

  it('12. Invalid log format -> error', async () => {
    const env = {
      ATOL_LOG_FORMAT: 'text'
    };

    await assert.rejects(
      () => loadConfig({ env, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Invalid runtime\.logFormat "text"/);
        return true;
      }
    );
  });

  it('13. Non-integer port from env -> error', async () => {
    const env = {
      ATOL_BOT_PORT: 'abc'
    };

    await assert.rejects(
      () => loadConfig({ env, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /ATOL_BOT_PORT must be a non-negative integer/);
        return true;
      }
    );
  });

  it('14. Non-integer port from TOML -> error', async () => {
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), '[webhook]\nport = "abc"', 'utf8');

    await assert.rejects(
      () => loadConfig({ env: {}, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Field webhook\.port must be a non-negative integer/);
        return true;
      }
    );
  });

  it('15. Negative integer -> error', async () => {
    const env = {
      ATOL_BOT_PORT: '-1'
    };

    await assert.rejects(
      () => loadConfig({ env, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /ATOL_BOT_PORT must be a non-negative integer/);
        return true;
      }
    );
  });

  it('16. Out-of-range jitter -> error', async () => {
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), '[reconnect]\njitter = 2.0', 'utf8');

    await assert.rejects(
      () => loadConfig({ env: {}, cwd: tmpDir }),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Field reconnect\.jitter must be a float in range \[0, 1\]/);
        return true;
      }
    );
  });

  it('17. Empty env value treated as unset', async () => {
    const env = {
      ATOL_LOG_LEVEL: ''
    };
    const config = await loadConfig({ env, cwd: tmpDir });

    assert.equal(config.runtime.logLevel, 'info');
  });

  it('18. Path resolution', async () => {
    const env = {
      ATOL_BOT_KEYSTORE: 'relative/path.keystore'
    };
    const config = await loadConfig({ env, cwd: tmpDir });

    assert.equal(config.keystorePath, path.resolve(tmpDir, 'relative/path.keystore'));
  });

  it('19. Returned object is frozen', async () => {
    const config = await loadConfig({ env: {}, cwd: tmpDir });

    assert.equal(Object.isFrozen(config), true);
    assert.equal(Object.isFrozen(config.runtime), true);
    assert.equal(Object.isFrozen(config.webhook), true);
    assert.equal(Object.isFrozen(config.cron), true);
    assert.equal(Object.isFrozen(config.reconnect), true);
    assert.equal(Object.isFrozen(config.shutdown), true);
    assert.equal(Object.isFrozen(config.diagnostics), true);

    assert.throws(() => {
      const runtime = /** @type {{ logLevel: string }} */ (/** @type {unknown} */ (config.runtime));
      runtime.logLevel = 'debug';
    }, TypeError);
  });

  it('20. Boolean from TOML', async () => {
    await fs.writeFile(path.join(tmpDir, 'bot.toml'), '[diagnostics]\nenabled = false', 'utf8');

    const config = await loadConfig({ env: {}, cwd: tmpDir });

    assert.equal(config.diagnostics.enabled, false);
  });
});
