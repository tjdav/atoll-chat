import eslintPluginImport from 'eslint-plugin-import'
import base from '../../eslint.config.js'

export default [
  ...base,
  {
    plugins: {
      import: eslintPluginImport
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/runtime',
              from: './src/testing',
              message: 'src/runtime must not import from src/testing.'
            },
            {
              target: './src/testing',
              from: './src/runtime/internal',
              message: 'src/testing must not import from src/runtime/internal.'
            }
          ]
        }
      ],
      'import/enforce-node-protocol-usage': ['error', 'always']
    }
  }
]
