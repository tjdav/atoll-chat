import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BASE_URL = 'https://huggingface.co/Supertone/supertonic/resolve/main'
const TARGET_DIR = path.join(__dirname, '../public/assets/tts')

const ONNX_MODELS = [
  'duration_predictor.onnx',
  'text_encoder.onnx',
  'tts.json',
  'tts.yml',
  'unicode_indexer.json',
  'vector_estimator.onnx',
  'vocoder.onnx'
]

const VOICE_STYLES = [
  'M1.json',
  'M2.json',
  'M3.json',
  'M4.json',
  'M5.json',
  'F1.json',
  'F2.json',
  'F3.json',
  'F4.json',
  'F5.json'
]

async function downloadFile (url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      // Handle redirects
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

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => reject(err))
      })
    }).on('error', reject)
  })
}

async function main () {
  const onnxDir = path.join(TARGET_DIR, 'onnx')
  const voiceStylesDir = path.join(TARGET_DIR, 'voice_styles')

  fs.mkdirSync(onnxDir, { recursive: true })
  fs.mkdirSync(voiceStylesDir, { recursive: true })

  console.log('Downloading ONNX models...')
  for (const model of ONNX_MODELS) {
    const dest = path.join(onnxDir, model)
    const url = `${BASE_URL}/onnx/${model}`
    if (fs.existsSync(dest)) {
      console.log(`Skipping ${model} (already exists)`)
      continue
    }
    console.log(`Downloading ${model}...`)
    await downloadFile(url, dest)
  }

  console.log('Downloading voice styles...')
  for (const style of VOICE_STYLES) {
    const dest = path.join(voiceStylesDir, style)
    const url = `${BASE_URL}/voice_styles/${style}`
    if (fs.existsSync(dest)) {
      console.log(`Skipping ${style} (already exists)`)
      continue
    }
    console.log(`Downloading ${style}...`)
    await downloadFile(url, dest)
  }

  console.log('Download complete!')
}

main().catch(console.error)
