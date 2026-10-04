/**
 * Client test batches.
 *
 * Every test file must appear in exactly one batch. The check-batches
 * script enforces this invariant.
 *
 * Each batch runs in under 60 seconds. If a batch exceeds that, split it.
 *
 * Adding a test file: add its path to an existing batch, or create a new
 * batch. Then run `pnpm check-batches`.
 */

export default [
  {
    name: 'unit-smoke',
    type: 'unit',
    runner: 'node',
    description: 'Smoke tests that prove the test runner is operational.',
    files: [
      'tests/unit/smoke.test.js',
      'tests/unit/oprf.test.js',
      'tests/unit/api.test.js',
      'tests/unit/codec.test.js',
      'tests/unit/auth-opaque.test.js',
      'tests/unit/auth-session.test.js',
      'tests/unit/auth-login-flow.test.js',
      'tests/unit/css-bundle.test.js',
      'tests/unit/crypto-display-name.test.js',
      'tests/unit/auth-identity.test.js',
      'tests/unit/auth-register-flow.test.js',
      'tests/unit/auth-boot.test.js',
      'tests/unit/i18n.test.js',
      'tests/unit/i18n-locales.test.js',
      'tests/unit/i18n-plugin.test.js',
      'tests/unit/components-defineComponent.test.js',
    ],
  },
  {
    name: 'component-smoke',
    type: 'component',
    runner: 'playwright',
    description: 'Smoke tests for component rendering and Playwright pipeline.',
    files: [
      'tests/component/smoke.spec.js',
      'tests/component/tokens.spec.js',
      'tests/component/css-applied.spec.js',
      'tests/component/hydration.spec.js',
    ],
  },
  {
    name: 'component-auth',
    type: 'component',
    runner: 'playwright',
    description: 'Component tests for authentication gate, login, and registration forms.',
    files: [
      'tests/component/auth-gate.spec.js',
      'tests/component/auth-login-flow.spec.js',
      'tests/component/register-form.spec.js',
      'tests/component/messenger-boot.spec.js',
    ],
  },
  {
    name: 'component-i18n',
    type: 'component',
    runner: 'playwright',
    description: 'Component tests for i18n locale rendering and migration verification.',
    files: [
      'tests/component/i18n-migration.spec.js',
    ],
  },
]
