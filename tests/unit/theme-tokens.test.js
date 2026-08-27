import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dual-resolution helper: Reads dist/assets/css/styles.css if present;
 * otherwise attempts dynamic sass compilation or scss file inspection fallback.
 */
async function getCompiledCss() {
  const distCssPath = path.resolve('dist/assets/css/styles.css');
  if (fs.existsSync(distCssPath)) {
    return fs.readFileSync(distCssPath, 'utf8');
  }

  const distDir = path.resolve('dist/assets/css');
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    const cssFile = files.find((f) => f.startsWith('styles') && f.endsWith('.css'));
    if (cssFile) {
      return fs.readFileSync(path.join(distDir, cssFile), 'utf8');
    }
  }

  // Fallback 1: Try dynamic import of 'sass'
  try {
    const sass = await import('sass');
    const scssPath = path.resolve('src/scss/styles.scss');
    const result = sass.compile(scssPath, {
      loadPaths: [path.resolve('node_modules'), path.resolve('src/scss')]
    });
    return result.css;
  } catch {
    // Fallback 2: Concatenate SCSS source files if dist artifact and sass module are unavailable
    const semanticScss = fs.readFileSync(path.resolve('src/scss/theme/_theme-semantic.scss'), 'utf8');
    const stylesScss = fs.readFileSync(path.resolve('src/scss/styles.scss'), 'utf8');
    const chatVariablesScss = fs.readFileSync(path.resolve('src/scss/theme/_atoll-chat-theme-variables.scss'), 'utf8');
    return semanticScss + '\n' + stylesScss + '\n' + chatVariablesScss;
  }
}

test('Theme Tokens & CSS Architecture Suite', async (t) => {
  const css = await getCompiledCss();

  await t.test(':root declares light-dark() semantic tokens', () => {
    assert.ok(css.includes(':root'), ':root block must exist');
    assert.ok(css.includes('light-dark('), 'CSS must contain light-dark() function definitions');
    assert.ok(css.includes('--atoll-body-bg'), '--atoll-body-bg token must be declared');
    assert.ok(css.includes('--atoll-bg-surface-primary'), '--atoll-bg-surface-primary token must be declared');
    assert.ok(css.includes('--atoll-text-primary'), '--atoll-text-primary token must be declared');
  });

  await t.test('Global overlay and backdrop tokens are declared on :root', () => {
    assert.ok(css.includes('--atoll-backdrop-filter: blur(8px)') || css.includes('--atoll-backdrop-filter:blur(8px)'), '--atoll-backdrop-filter token must be blur(8px)');
    assert.ok(
      css.includes('--atoll-backdrop-bg: rgba(0, 0, 0, 0.45)') ||
      css.includes('--atoll-backdrop-bg: rgba(0, 0, 0, .45)') ||
      css.includes('--atoll-backdrop-bg:rgba(0,0,0,.45)') ||
      css.includes('--atoll-backdrop-bg:rgba(0, 0, 0, 0.45)'),
      '--atoll-backdrop-bg token must be rgba(0, 0, 0, 0.45)'
    );
  });

  await t.test('Core layout utilities and primitives are present in stylesheet', () => {
    assert.ok(css.includes('.d-flex'), '.d-flex utility must be present');
    assert.ok(css.includes('.gap-2'), '.gap-2 utility must be present');
    assert.ok(css.includes('.p-3'), '.p-3 utility must be present');
    assert.ok(css.includes('.w-100'), '.w-100 utility must be present');
    assert.ok(css.includes('.align-items-center'), '.align-items-center utility must be present');
    assert.ok(css.includes('.card'), '.card primitive must be present');
    assert.ok(css.includes('.modal'), '.modal primitive must be present');
    assert.ok(css.includes('.btn'), '.btn primitive must be present');
  });

  await t.test('Pruned Bootstrap component classes are strictly absent', () => {
    // Check for standard Bootstrap component rules using word boundary regexes
    const prunedSelectors = [
      /\.toast\b/,
      /\.popover\b/,
      /\.pagination\b/,
      /\.breadcrumb\b/,
      /\.table\b/
    ];

    for (const selector of prunedSelectors) {
      assert.strictEqual(
        selector.test(css),
        false,
        `Stylesheet should not contain pruned Bootstrap class matching ${selector}`
      );
    }
  });

  await t.test('Explicit theme controls specify color-scheme', () => {
    assert.ok(css.includes('color-scheme: light dark') || css.includes('color-scheme:light dark'), ':root must specify color-scheme: light dark');
    assert.ok(css.includes('color-scheme: light') || css.includes('color-scheme:light'), 'Light theme selectors must set color-scheme: light');
    assert.ok(css.includes('color-scheme: dark') || css.includes('color-scheme:dark'), 'Dark theme selectors must set color-scheme: dark');
  });

  await t.test('Room preset themes apply token overrides', () => {
    assert.ok(css.includes('[data-theme=ocean]') || css.includes('[data-theme="ocean"]'), '[data-theme="ocean"] rule must exist');
    assert.ok(css.includes('[data-theme=sunset]') || css.includes('[data-theme="sunset"]'), '[data-theme="sunset"] rule must exist');
    assert.ok(css.includes('[data-theme=forest]') || css.includes('[data-theme="forest"]'), '[data-theme="forest"] rule must exist');
    assert.ok(css.includes('#00d2ff'), 'Ocean theme accent token (#00d2ff) must be compiled');
    assert.ok(css.includes('#38ef7d'), 'Forest theme accent token (#38ef7d) must be compiled');
    assert.ok(css.includes('#f5af19'), 'Sunset theme accent token (#f5af19) must be compiled');
    assert.ok(css.includes('--atoll-chat-surface-glass'), 'Glassmorphic token (--atoll-chat-surface-glass) must be present');
  });
});
