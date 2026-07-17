import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const targetDir = path.join(__dirname, '../tests/e2e/fixtures')
const targetPath = path.join(targetDir, 'test-video.y4m')

// Create target directory if it doesn't exist
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true })
}

const width = 128
const height = 96
const numFrames = 10

/* YUV4MPEG2 Header: W = Width, H = Height, F = Framerate (30:1), Ip = Progressive, C = Chroma Subsampling (420jpeg) */
const fileHeader = `YUV4MPEG2 W${width} H${height} F30:1 Ip C420jpeg\n`
const frameHeader = 'FRAME\n'

const ySize = width * height
const uSize = (width / 2) * (height / 2)
const vSize = (width / 2) * (height / 2)
const frameDataSize = ySize + uSize + vSize

const buffers = [Buffer.from(fileHeader, 'ascii')]

for (let i = 0; i < numFrames; i++) {
  buffers.push(Buffer.from(frameHeader, 'ascii'))

  const frameBuffer = Buffer.alloc(frameDataSize)
  // Fill Y plane (luma) with a gradient or distinct pattern
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = (((y * 2) + x) + (i * 4)) % 256
      frameBuffer[(y * width) + x] = val
    }
  }
  // Fill U and V planes (chroma) with neutral color values
  frameBuffer.fill(128, ySize, frameDataSize)

  buffers.push(frameBuffer)
}

fs.writeFileSync(targetPath, Buffer.concat(buffers))
console.log(`Successfully generated fake Y4M video fixture at: ${targetPath}`)
