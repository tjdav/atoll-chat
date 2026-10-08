import rootConfig from '../../eslint.config.js'

/**
 * Typedef names declared in src/types.js. Added to the JSDoc rule's
 * defined types so bare-name references resolve.
 * @type {string[]}
 */
const definedTypes = []

export default [
  ...rootConfig,
  {
    files: ['src/**/*.js'],
    rules: {
      'jsdoc/no-undefined-types': ['error', { definedTypes }]
    }
  }
]
