import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ExtensionRegistry, validateLink, buildVocabulary } from '@atoll/extend'
import { extensions } from '../../src/extensions/index.js'

/**
 * Unit tests for first-party extension definitions and aggregator.
 */
describe('First-Party Extension Definitions', () => {
  it('1. Exports all ten first-party extensions from aggregator', () => {
    assert.strictEqual(Array.isArray(extensions), true)
    assert.strictEqual(extensions.length, 10)
  })

  it('2. Every extension has a unique id', () => {
    const ids = extensions.map((ext) => ext.id)
    const uniqueIds = new Set(ids)
    assert.strictEqual(uniqueIds.size, 10)
  })

  it('3. ExtensionRegistry accepts all ten extensions', () => {
    const registry = new ExtensionRegistry()
    for (const ext of extensions) {
      registry.add(ext)
    }
    assert.strictEqual(registry.size(), 10)
  })

  it('4. validateLink passes across all registered extensions without errors', () => {
    const registry = new ExtensionRegistry()
    for (const ext of extensions) {
      registry.add(ext)
    }
    const result = validateLink(registry)
    assert.ok(result && Array.isArray(result.warnings))
    assert.strictEqual(result.warnings.length, 0)
  })

  it('5. byRailOrder returns rail-bearing extensions in correct sorted order', () => {
    const registry = new ExtensionRegistry()
    for (const ext of extensions) {
      registry.add(ext)
    }
    const railExts = registry.byRailOrder()
    assert.strictEqual(railExts.length, 6)

    const expectedOrder = [
      'core.chat',
      'core.media',
      'core.documents',
      'core.links',
      'core.calls',
      'core.settings'
    ]
    const actualOrder = railExts.map((ext) => ext.id)
    assert.deepStrictEqual(actualOrder, expectedOrder)
  })

  it('6. ownerOfRoute resolves each detail route to its owning extension', () => {
    const registry = new ExtensionRegistry()
    for (const ext of extensions) {
      registry.add(ext)
    }

    for (const ext of extensions) {
      const owner = registry.ownerOfRoute(ext.detail.route)
      assert.ok(owner, `Route ${ext.detail.route} should have an owner`)
      assert.strictEqual(owner.id, ext.id)
    }
  })

  it('7. buildVocabulary accurately lists routes, sessions, and permissions', () => {
    const registry = new ExtensionRegistry()
    for (const ext of extensions) {
      registry.add(ext)
    }

    const vocab = buildVocabulary(registry)
    assert.strictEqual(vocab.routes.details.length, 10)
    assert.strictEqual(vocab.routes.lists.length, 8)
    assert.strictEqual(vocab.sessions.length, 1)
    assert.strictEqual(vocab.permissions.length, 0)
  })

  it('8. The session type is registered correctly for core.hangouts', () => {
    const registry = new ExtensionRegistry()
    for (const ext of extensions) {
      registry.add(ext)
    }

    const vocab = buildVocabulary(registry)
    assert.strictEqual(vocab.sessions.length, 1)
    assert.strictEqual(vocab.sessions[0].type, 'voice')
    assert.strictEqual(vocab.sessions[0].extensionId, 'core.hangouts')
  })

  it('9. The placeholder component tag is referenced by all un-implemented list and detail surfaces', () => {
    for (const ext of extensions) {
      if (ext.id === 'core.chat') {
        assert.strictEqual(ext.list.component, 'view-chats')
        assert.strictEqual(ext.detail.component, 'view-chat')
        continue
      }
      assert.strictEqual(
        ext.detail.component,
        'extension-placeholder',
        `Extension ${ext.id} detail component should be extension-placeholder`
      )
      if (ext.list) {
        assert.strictEqual(
          ext.list.component,
          'extension-placeholder',
          `Extension ${ext.id} list component should be extension-placeholder`
        )
      }
    }
  })

  it('10. The core.hangouts voice session declaration matches the specification limits', () => {
    const hangouts = extensions.find((ext) => ext.id === 'core.hangouts')
    assert.ok(hangouts, 'core.hangouts should exist')
    assert.ok(Array.isArray(hangouts.sessions), 'sessions should be an array')
    assert.strictEqual(hangouts.sessions.length, 1)

    const voiceSession = hangouts.sessions[0]
    assert.strictEqual(voiceSession.type, 'voice')
    assert.strictEqual(voiceSession.maxParticipants, 12)
    assert.strictEqual(voiceSession.maxPerRoom, 3)
    assert.strictEqual(voiceSession.heartbeatInterval, 15)
  })
})
