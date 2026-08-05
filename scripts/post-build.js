// scripts/post-build.js
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const indexHtmlPath = 'dist/index.html'

if (fs.existsSync(indexHtmlPath)) {
  let content = fs.readFileSync(indexHtmlPath, 'utf8')

  // Regex to match the inline script tag without a src attribute
  const regex = /<script type="module">([\s\S]*?)<\/script>/
  const match = content.match(regex)

  if (match) {
    const inlineScript = match[1]

    // Save to a file
    const bootstrapFilename = 'bootstrap-app.js'
    const bootstrapDir = 'dist/assets/js'
    fs.mkdirSync(bootstrapDir, { recursive: true })
    const bootstrapPath = path.join(bootstrapDir, bootstrapFilename)
    fs.writeFileSync(bootstrapPath, inlineScript, 'utf8')

    // Calculate sha384 hash of bootstrap file
    const hash = crypto.createHash('sha384').update(inlineScript).digest('base64')
    const integrity = `sha384-${hash}`

    // Replace the inline script with the external script with SRI and crossorigin attributes
    const replacement = `<script type="module" src="/assets/js/${bootstrapFilename}" integrity="${integrity}" crossorigin="anonymous" defer></script>`
    content = content.replace(match[0], replacement)

    // Move <script type="importmap"> to the very top of <head> for Firefox ES module compliance
    content = content.replace(/(<head.*?>)([\s\S]*?)(<script type="importmap">[\s\S]*?<\/script>)/i, '$1\n  $3$2')

    fs.writeFileSync(indexHtmlPath, content, 'utf8')
    console.log(`[Post-Build] Successfully extracted inline bootstrap script to /assets/js/${bootstrapFilename} and applied SRI (hash: ${integrity})!`)
  } else {
    // Ensure importmap is moved even if no inline script was found
    content = content.replace(/(<head.*?>)([\s\S]*?)(<script type="importmap">[\s\S]*?<\/script>)/i, '$1\n  $3$2')
    fs.writeFileSync(indexHtmlPath, content, 'utf8')
    console.log('[Post-Build] No inline bootstrap script found in dist/index.html.')
  }
} else {
  console.error('[Post-Build] Error: dist/index.html not found!')
}
