import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getAST, clearASTCache } from '../../../../../lib/utils/server/server.js'

describe('AST Cache & getAST Hardening', () => {
  beforeEach(() => {
    clearASTCache()
  })

  it('maintains reference equality for repeated getAST calls with identical locations flag', () => {
    const code = 'const x = 42;'

    const astNoLoc1 = getAST(code, false)
    const astNoLoc2 = getAST(code, false)
    assert.strictEqual(astNoLoc1, astNoLoc2, 'getAST(code, false) should return identical cached AST reference')

    const astLoc1 = getAST(code, true)
    const astLoc2 = getAST(code, true)
    assert.strictEqual(astLoc1, astLoc2, 'getAST(code, true) should return identical cached AST reference')

    // Default parameter check (locations defaults to false)
    const astDefault = getAST(code)
    assert.strictEqual(astDefault, astNoLoc1, 'getAST(code) default should match locations: false cache')
  })

  it('segregates caches based on the locations flag', () => {
    const code = 'function hello() { return "world"; }'

    const astNoLoc = getAST(code, false)
    const astWithLoc = getAST(code, true)

    assert.notStrictEqual(astNoLoc, astWithLoc, 'locations: false and locations: true must return distinct AST instances')

    // Node location verification
    assert.strictEqual(astNoLoc.loc, undefined, 'locations: false AST root should not have .loc property')
    assert.ok(typeof astNoLoc.start === 'number' && typeof astNoLoc.end === 'number', 'locations: false AST root must have .start and .end')

    assert.ok(astWithLoc.loc !== undefined, 'locations: true AST root should have .loc property')
    assert.ok(typeof astWithLoc.loc.start === 'object' && typeof astWithLoc.loc.end === 'object', 'locations: true AST root .loc must contain start and end positions')
    assert.ok(typeof astWithLoc.start === 'number' && typeof astWithLoc.end === 'number', 'locations: true AST root must have .start and .end')
  })

  it('clears internal AST caches when clearASTCache is invoked', () => {
    const code = 'let a = 1 + 2;'

    const firstNoLoc = getAST(code, false)
    const firstLoc = getAST(code, true)

    clearASTCache()

    const secondNoLoc = getAST(code, false)
    const secondLoc = getAST(code, true)

    assert.notStrictEqual(secondNoLoc, firstNoLoc, 'getAST(code, false) should return new instance after clearASTCache()')
    assert.notStrictEqual(secondLoc, firstLoc, 'getAST(code, true) should return new instance after clearASTCache()')
  })

  it('handles syntax errors without caching corrupt entries', () => {
    const invalidCode = 'const x = ;'

    assert.throws(
      () => getAST(invalidCode, false),
      (err) => err instanceof SyntaxError,
      'Invalid JavaScript must throw SyntaxError'
    )

    // Re-running invalid code should throw again (not return a cached undefined or corrupted entry)
    assert.throws(
      () => getAST(invalidCode, false),
      (err) => err instanceof SyntaxError,
      'Subsequent calls with invalid code should also throw SyntaxError'
    )

    // Valid code after error parses and caches properly
    const validCode = 'const x = 10;'
    const ast = getAST(validCode, false)
    assert.ok(ast && ast.type === 'Program')
  })

  it('preserves AST immutability across multi-pass extraction phases', () => {
    const sampleScript = `
      import { state } from 'coralite';
      export const client = { count: 0 };
      export const server = { secret: 'abc' };
      function extractGlobals() { return true; }
    `

    // Initial AST parse and deep clone baseline
    const initialAST = getAST(sampleScript, true)
    const originalJSON = JSON.stringify(initialAST)

    // Simulated multi-pass extraction visitors (read-only operations / string-slicing)
    const mockFindAndExtractScript = (code) => {
      const ast = getAST(code, true)
      return code.slice(ast.start, ast.end)
    }

    const mockExtractComponentProperty = (code, name) => {
      const ast = getAST(code, true)
      const exportDecl = ast.body.find(
        (node) => node.type === 'ExportNamedDeclaration' &&
          node.declaration?.declarations?.[0]?.id?.name === name
      )
      return exportDecl ? code.slice(exportDecl.start, exportDecl.end) : null
    }

    const mockFindAndExtractImperativeComponents = (code) => {
      const ast = getAST(code, true)
      return ast.body.filter((node) => node.type === 'FunctionDeclaration')
    }

    const mockExtractGlobals = (code) => {
      const ast = getAST(code, true)
      return ast.body.filter((node) => node.type === 'ImportDeclaration')
    }

    // Sequentially execute extraction phases
    mockFindAndExtractScript(sampleScript)
    mockExtractComponentProperty(sampleScript, 'client')
    mockExtractComponentProperty(sampleScript, 'server')
    mockFindAndExtractImperativeComponents(sampleScript)
    mockExtractGlobals(sampleScript)

    // Retrieve cached AST post-extractions
    const cachedAST = getAST(sampleScript, true)

    // Assert reference identity and zero mutations
    assert.strictEqual(cachedAST, initialAST, 'Cached AST must maintain exact reference identity')
    assert.strictEqual(JSON.stringify(cachedAST), originalJSON, 'Cached AST structure and nodes must remain unmutated')
  })
})
