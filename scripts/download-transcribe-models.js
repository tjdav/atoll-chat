import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin'
const TARGET_DIR = path.join(__dirname, '../public/assets/models/whisper')
const TARGET_FILE = path.join(TARGET_DIR, 'ggml-tiny-q5_1.bin')

async function downloadFile (url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location
        if (redirectUrl.startsWith('/')) {
          redirectUrl = 'https://huggingface.co' + redirectUrl
        }
        return downloadFile(redirectUrl, destPath).then(resolve).catch(reject)
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode} ${response.statusMessage}`))
        return
      }

      const fileStream = fs.createWriteStream(destPath)
      response.pipe(fileStream)

      fileStream.on('finish', () => {
        fileStream.close(resolve)
      })

      fileStream.on('error', (error) => {
        fs.unlink(destPath, () => reject(error))
      })
    }).on('error', reject)
  })
}

async function main () {
  fs.mkdirSync(TARGET_DIR, { recursive: true })

  if (fs.existsSync(TARGET_FILE)) {
    console.log(`Skipping ggml-tiny-q5_1.bin (already exists)`)
    return
  }

  console.log('Downloading Whisper model...')
  await downloadFile(MODEL_URL, TARGET_FILE)
  console.log('Download complete!')
}

main().catch(console.error)
