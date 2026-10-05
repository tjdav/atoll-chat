import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../../scripts/extensions-vocab.js'

describe('extensions-vocab CLI unit tests', () => {
  function createMockIo() {
    const outLines = []
    const errLines = []
    return {
      io: {
        out: (msg) => outLines.push(String(msg)),
        err: (msg) => errLines.push(String(msg))
      },
      outLines,
      errLines
    }
  }

  test('1. main([], io) prints all section headers', () => {
    const { io, outLines } = createMockIo()
    const exitCode = main([], io)
    assert.equal(exitCode, 0)
    const combined = outLines.join('\n')
    assert.match(combined, /Components \(\d+\):/)
    assert.match(combined, /Slots \(\d+\):/)
    assert.match(combined, /Events \(\d+\):/)
    assert.match(combined, /Routes \(\d+\):/)
    assert.match(combined, /Platforms \(\d+\):/)
    assert.match(combined, /Surfaces \(\d+\):/)
    assert.match(combined, /Reserved:/)
  })

  test('2. main(["--json"], io) prints valid JSON parsable to an object with all sections', () => {
    const { io, outLines } = createMockIo()
    const exitCode = main(['--json'], io)
    assert.equal(exitCode, 0)
    const parsed = JSON.parse(outLines.join(''))
    assert.equal(typeof parsed, 'object')
    assert.equal(Array.isArray(parsed.components), true)
    assert.equal(typeof parsed.slots, 'object')
    assert.equal(typeof parsed.events, 'object')
    assert.equal(typeof parsed.routes, 'object')
  })

  test('3. main(["--section=components"], io) prints only the components section', () => {
    const { io, outLines } = createMockIo()
    const exitCode = main(['--section=components'], io)
    assert.equal(exitCode, 0)
    const combined = outLines.join('\n')
    assert.match(combined, /Components \(\d+\):/)
    assert.equal(combined.includes('Slots ('), false)
    assert.equal(combined.includes('Events ('), false)
  })

  test('4. main(["--section=unknown"], io) writes an error and returns 1', () => {
    const { io, errLines } = createMockIo()
    const exitCode = main(['--section=unknown'], io)
    assert.equal(exitCode, 1)
    assert.match(errLines.join(''), /Unknown section 'unknown'/)
  })

  test('5. main(["--json", "--section=routes"], io) prints JSON of one section', () => {
    const { io, outLines } = createMockIo()
    const exitCode = main(['--json', '--section=routes'], io)
    assert.equal(exitCode, 0)
    const parsed = JSON.parse(outLines.join(''))
    assert.equal(typeof parsed, 'object')
    assert.equal(typeof parsed.routes, 'object')
    assert.equal(parsed.components, undefined)
  })
})
