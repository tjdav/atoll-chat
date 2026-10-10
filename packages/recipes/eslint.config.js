import rootConfig from '../../eslint.config.js'

/**
 * Typedef names declared in src/types.js. Added to the JSDoc rule's
 * defined types so bare-name references resolve.
 * @type {string[]}
 */
const definedTypes = [
  'Primitive',
  'PrimitiveInstance',
  'Handler',
  'StoreMode',
  'RecipeKind',
  'RecipeTarget',
  'Slot',
  'Recipe',
  'Intent',
  'Candidate',
  'MatchResult',
  'RankOptions',
  'Embedder',
  'Instantiation',
  'Composition',
  'BotScript',
  'OperatorBinding',
  'OperatorPolicy',
  'ConsentTier',
  'TelemetryRecord'
]

export default [
  ...rootConfig,
  {
    ignores: ['!tests/**', '!**/tests/**']
  },
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    rules: {
      'jsdoc/no-undefined-types': ['error', { definedTypes }]
    }
  }
]
