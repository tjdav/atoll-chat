import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseToml } from '../../src/runtime/config/toml.js';

describe('TOML parser unit tests', () => {
  it('1. Empty document returns empty object', () => {
    const res = parseToml('');
    assert.deepEqual(res, {});
  });

  it('2. Only comments returns empty object', () => {
    const res = parseToml('# line 1\n# line 2\n  # line 3');
    assert.deepEqual(res, {});
  });

  it('3. Single section, single string key', () => {
    const source = `
[section1]
key1 = "value1"
`;
    const res = parseToml(source);
    assert.deepEqual(res, {
      section1: {
        key1: 'value1'
      }
    });
  });

  it('4. Multiple sections', () => {
    const source = `
[sec1]
a = "hello"

[sec2]
b = "world"
`;
    const res = parseToml(source);
    assert.deepEqual(res, {
      sec1: { a: 'hello' },
      sec2: { b: 'world' }
    });
  });

  it('5. Integer value', () => {
    const source = `
[server]
port = 8080
`;
    const res = parseToml(source);
    const server = res.server;
    assert.ok(server);
    assert.equal(server.port, 8080);
  });

  it('6. Float value', () => {
    const source = `
[reconnect]
jitter = 0.25
`;
    const res = parseToml(source);
    const reconnect = res.reconnect;
    assert.ok(reconnect);
    assert.equal(reconnect.jitter, 0.25);
  });

  it('7. Boolean true', () => {
    const source = `
[feature]
enabled = true
`;
    const res = parseToml(source);
    const feature = res.feature;
    assert.ok(feature);
    assert.equal(feature.enabled, true);
  });

  it('8. Boolean false', () => {
    const source = `
[feature]
enabled = false
`;
    const res = parseToml(source);
    const feature = res.feature;
    assert.ok(feature);
    assert.equal(feature.enabled, false);
  });

  it('9. Escaped double-quote in a string', () => {
    const source = `
[msg]
text = "Hello \\"world\\""
`;
    const res = parseToml(source);
    const msg = res.msg;
    assert.ok(msg);
    assert.equal(msg.text, 'Hello "world"');
  });

  it('10. Escaped backslash in a string', () => {
    const source = `
[path]
win = "C:\\\\Users\\\\Admin"
`;
    const res = parseToml(source);
    const pathObj = res.path;
    assert.ok(pathObj);
    assert.equal(pathObj.win, 'C:\\Users\\Admin');
  });

  it('11. Escaped newline in a string', () => {
    const source = `
[text]
lines = "line1\\nline2"
`;
    const res = parseToml(source);
    const text = res.text;
    assert.ok(text);
    assert.equal(text.lines, 'line1\nline2');
  });

  it('12. Trailing comment after a value', () => {
    const source = `
[webhook]
port = 8787 # default port
host = "0.0.0.0" # bind all
`;
    const res = parseToml(source);
    const webhook = res.webhook;
    assert.ok(webhook);
    assert.equal(webhook.port, 8787);
    assert.equal(webhook.host, '0.0.0.0');
  });

  it('13. Blank line inside a section', () => {
    const source = `
[section]
a = 1

b = 2
`;
    const res = parseToml(source);
    assert.deepEqual(res.section, { a: 1, b: 2 });
  });

  it('14. Duplicate key in same section is an error', () => {
    const source = `
[section]
key = 1
key = 2
`;
    assert.throws(
      () => parseToml(source),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Duplicate key "key"/);
        assert.match(e.message, /Line 4/);
        return true;
      }
    );
  });

  it('15. Unknown syntax is an error', () => {
    const source = `[sec]
foo bar
`;
    assert.throws(
      () => parseToml(source),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Line 2/);
        assert.match(e.message, /Invalid TOML syntax/);
        return true;
      }
    );
  });

  it('16. Dotted section name is an error', () => {
    const source = `
[a.b]
c = 1
`;
    assert.throws(
      () => parseToml(source),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Line 2/);
        assert.match(e.message, /Invalid section name/);
        return true;
      }
    );
  });

  it('17. Key before any section is an error', () => {
    const source = `key = "value"
[sec]
a = 1
`;
    assert.throws(
      () => parseToml(source),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Line 1/);
        assert.match(e.message, /specified before any section header/);
        return true;
      }
    );
  });

  it('18. Unterminated string is an error', () => {
    const source = `[sec]
msg = "hello
`;
    assert.throws(
      () => parseToml(source),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Line 2/);
        assert.match(e.message, /Unterminated string literal/);
        return true;
      }
    );
  });

  it('19. Unknown escape is an error', () => {
    const source = `[sec]
val = "a\\qb"
`;
    assert.throws(
      () => parseToml(source),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Line 2/);
        assert.match(e.message, /Invalid escape sequence \\q/);
        return true;
      }
    );
  });

  it('20. Missing value after = is an error', () => {
    const source = `[sec]
key =
`;
    assert.throws(
      () => parseToml(source),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Line 2/);
        assert.match(e.message, /Missing value after =/);
        return true;
      }
    );
  });

  it('21. Error message includes the line number', () => {
    const source = `# line 1
# line 2
[sec]
# line 4
bad syntax line 5
`;
    assert.throws(
      () => parseToml(source),
      (err) => {
        const e = /** @type {Error} */ (err);
        assert.match(e.message, /Line 5/);
        return true;
      }
    );
  });
});
