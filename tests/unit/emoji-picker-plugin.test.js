import test from 'node:test'
import assert from 'node:assert/strict'
import emojiPickerPlugin from '../../src/plugins/emoji-picker-plugin.js'

test('Emoji Picker Plugin Tests', async (t) => {
  await t.test('should initialize context and export $emojiPicker service', async () => {
    const mockPluginContext = {}
    const resolver = emojiPickerPlugin.client.context(mockPluginContext)
    const instanceContext = resolver({})

    assert.ok(instanceContext.$emojiPicker, '$emojiPicker service should be defined')
    assert.equal(typeof instanceContext.$emojiPicker.createPicker, 'function', 'createPicker should be a function')
  })

  await t.test('should default dataSource to /assets/emoji-en.json when creating picker in browser environment', async () => {
    const resolver = emojiPickerPlugin.client.context({})
    const { $emojiPicker } = resolver({})

    const picker = await $emojiPicker.createPicker({})

    assert.ok(picker, 'Picker element should be created')
    assert.equal(picker.dataSource, '/assets/emoji-en.json', 'dataSource should default to /assets/emoji-en.json')
  })

  await t.test('should allow custom dataSource override when provided', async () => {
    const resolver = emojiPickerPlugin.client.context({})
    const { $emojiPicker } = resolver({})

    const customSource = '/custom/emoji.json'
    const picker = await $emojiPicker.createPicker({ dataSource: customSource })

    assert.ok(picker, 'Picker element should be created')
    assert.equal(picker.dataSource, customSource, 'dataSource should match custom value')
  })
})
