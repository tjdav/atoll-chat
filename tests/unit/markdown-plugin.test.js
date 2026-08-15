import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import markdownPlugin from '../../src/plugins/markdown-plugin.js'

describe('Markdown Plugin Syntax Highlighting', () => {
  const contextFn = markdownPlugin.client.context()
  const { renderMarkdown } = contextFn()

  test('should render plain text as simple paragraph', async () => {
    const html = await renderMarkdown('Hello world')
    assert.equal(html, '<p>Hello world</p>')
  })

  test('should escape HTML special characters in fast path', async () => {
    const html = await renderMarkdown('Hello "world"')
    assert.equal(html, '<p>Hello &quot;world&quot;</p>')
  })

  test('should sanitize XSS payloads that trigger marked route', async () => {
    const html = await renderMarkdown('<script>alert("xss")</script>')
    assert.equal(html.includes('<script>'), false)
  })

  test('should highlight code blocks with explicit language', async () => {
    const md = '```js\nconst a = 123;\n```'
    const html = await renderMarkdown(md)
    assert.ok(html.includes('<pre><code class="hljs language-js">'), 'Should wrap in pre and code with hljs and js class')
    assert.ok(html.includes('<span class="hljs-keyword">const</span>'), 'Should highlight const keyword')
    assert.ok(html.includes('<span class="hljs-number">123</span>'), 'Should highlight number literal')
  })

  test('should highlight code blocks with auto-detection', async () => {
    const md = '```\nconst x = "hello";\n```'
    const html = await renderMarkdown(md)
    assert.ok(html.includes('<pre><code class="hljs">'), 'Should wrap in pre and code with hljs class')
    assert.ok(html.includes('hljs-'), 'Should contain hljs classes via auto-detection')
  })
})
