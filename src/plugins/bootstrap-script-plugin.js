import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { definePlugin } from 'coralite'

/**
 * Calculates sha384 SRI hash string for given content.
 *
 * @param {string|Buffer} content Content to hash.
 * @returns {string} SRI hash string (sha384-...).
 */
function getSriHash (content) {
  const hash = crypto.createHash('sha384').update(content).digest('base64')
  return `sha384-${hash}`
}

/**
 * Coralite build plugin to dynamically manage asset script tags, extract inline
 * bootstrap module script into assets/js/bootstrap-app.js, compute dynamic SRI hashes,
 * and inject relative script tags into dist/index.html.
 *
 * @returns {import('coralite').CoralitePlugin} The plugin definition.
 */
export default function bootstrapScriptPlugin () {
  return definePlugin({
    name: 'bootstrapScriptExtractor',
    server: {
      onAfterBuild: async ({ app }) => {
        const outputDir = app.options.output
        if (!outputDir) {
          return
        }

        const indexHtmlPath = join(outputDir, 'index.html')
        let content
        try {
          content = await readFile(indexHtmlPath, 'utf8')
        } catch {
          return
        }

        // Extract inline bootstrap script if present
        const inlineScriptRegex = /<script type="module">([\s\S]*?)<\/script>/
        const inlineMatch = content.match(inlineScriptRegex)

        const bootstrapFilename = 'bootstrap-app.js'
        let bootstrapSri = ''

        if (inlineMatch) {
          const inlineScript = inlineMatch[1]

          // Use app.writeFile to write and automatically track the output file in Coralite
          await app.writeFile(`assets/js/${bootstrapFilename}`, inlineScript)
          bootstrapSri = getSriHash(inlineScript)

          // Remove original inline script tag from content
          content = content.replace(inlineMatch[0], '')
        } else {
          const bootstrapFullPath = join(outputDir, 'assets', 'js', bootstrapFilename)
          if (existsSync(bootstrapFullPath)) {
            app.trackOutputFile(bootstrapFullPath)
            try {
              const scriptContent = await readFile(bootstrapFullPath, 'utf8')
              bootstrapSri = getSriHash(scriptContent)
            } catch {
              /* ignore */
            }
          }
        }

        // Remove any previously injected or hardcoded asset script tags to avoid duplication
        content = content.replace(/<script[^>]*src=["'](?:\.|\/)?\/?assets\/altcha\.js["'][^>]*>(?:[\s\S]*?<\/script>)?/gi, '')
        content = content.replace(/<script[^>]*src=["']\/?assets\/register-sw\.js["'][^>]*>[\s\S]*?<\/script>/gi, '')
        content = content.replace(/<script[^>]*src=["']\.\/assets\/js\/bootstrap-app\.js["'][^>]*>[\s\S]*?<\/script>/gi, '')
        content = content.replace(/<script[^>]*src=["']\/assets\/js\/bootstrap-app\.js["'][^>]*>[\s\S]*?<\/script>/gi, '')

        // Compute dynamic SRI for altcha.js if present
        const altchaPath = join(outputDir, 'assets', 'altcha.js')
        let altchaTag = ''
        if (existsSync(altchaPath)) {
          const altchaContent = await readFile(altchaPath, 'utf8')
          const altchaSri = getSriHash(altchaContent)
          altchaTag = `\n  <script type="module" src="./assets/altcha.js" integrity="${altchaSri}" crossorigin="anonymous"></script>`
        }

        // Compute dynamic SRI for register-sw.js if present
        const swPath = join(outputDir, 'assets', 'register-sw.js')
        let swTag = ''
        if (existsSync(swPath)) {
          const swContent = await readFile(swPath, 'utf8')
          const swSri = getSriHash(swContent)
          swTag = `\n  <script type="module" src="./assets/register-sw.js" integrity="${swSri}" crossorigin="anonymous" defer></script>`
        }

        // Build bootstrap-app.js tag
        let bootstrapTag = ''
        if (bootstrapSri) {
          bootstrapTag = `\n  <script type="module" src="./assets/js/${bootstrapFilename}" integrity="${bootstrapSri}" crossorigin="anonymous" defer></script>`
        }

        // Ensure relative favicon link exists in <head>
        if (!content.includes('rel="icon"')) {
          content = content.replace(/<\/head>/i, '  <link rel="icon" type="image/x-icon" href="./favicon.ico">\n</head>')
        } else {
          content = content.replace(/href=["']\/favicon\.ico["']/i, 'href="./favicon.ico"')
        }

        // Inject asset scripts right before </body>
        const injectedScripts = `${altchaTag}${swTag}${bootstrapTag}\n</body>`
        content = content.replace(/<\/body>/i, injectedScripts)

        // Ensure importmap is moved to top of head for Firefox ES module compliance
        content = content.replace(/(<head.*?>)([\s\S]*?)(<script type="importmap">[\s\S]*?<\/script>)/i, '$1\n  $3$2')

        await writeFile(indexHtmlPath, content, 'utf8')
      }
    }
  })
}
