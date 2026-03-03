import fs from 'node:fs'
import os from 'node:os'
import https from 'node:https'
import { createWriteStream } from 'node:fs'

import AdmZip from 'adm-zip'

/**
 * @typedef GitHubReleaseResponse Type definition for GitHub release response structure.
 * @property {GitHubReleaseAsset[]} assets
 */

/**
 * @typedef GitHubReleaseAsset
 * @property {string} name
 * @property {string} browser_download_url
 */

/**
 * GitHub repository owner for PocketBase.
 */
const REPO_OWNER = 'pocketbase'

/**
 * GitHub repository name for PocketBase.
 */
const REPO_NAME = 'pocketbase'

/**
 * URL to fetch the latest release information from GitHub API.
 */
const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`

/**
 * Directory where the PocketBase binary will be stored.
 */
const DATABASE_DIR = './database'

/**
 * Current operating system platform (e.g., 'linux', 'darwin', 'win32').
 */
const PLATFORM = os.platform()

/**
 * Current CPU architecture (e.g., 'x64', 'arm64', 'arm').
 */
const ARCH = os.arch()

/**
 * Returns the binary name for the current platform.
 * @returns {string} The binary filename ('pocketbase.exe' on Windows, 'pocketbase' otherwise).
 */
const getBinaryName = () => {
  return PLATFORM === 'win32' ? 'pocketbase.exe' : 'pocketbase'
}

/**
 * Returns the target platform string for release asset matching.
 * @returns {string} The platform identifier ('windows', 'darwin', 'linux', or other).
 */
const getTargetPlatform = () => {
  switch (PLATFORM) {
    case 'win32': return 'windows'
    case 'darwin': return 'darwin'
    case 'linux': return 'linux'
    default: return PLATFORM
  }
}

/**
 * Returns the target architecture string for release asset matching.
 * @returns {string} The architecture identifier ('amd64', 'arm64', 'armv7', or other).
 */
const getTargetArch = () => {
  switch (ARCH) {
    case 'x64': return 'amd64'
    case 'arm64': return 'arm64'
    case 'arm': return 'armv7'
    default: return ARCH
  }
}

/**
 * Fetches JSON data from the given URL with automatic redirect following.
 * @param {string} url - The API endpoint URL to fetch.
 * @returns {Promise<GitHubReleaseResponse>} Parsed JSON response from the server.
 */
const fetchJson = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Node.js/Pocketbase-Downloader' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return resolve(fetchJson(res.headers.location))
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`))
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

/**
 * Downloads a file from the given URL to the specified destination.
 * Supports automatic redirect following and cleans up temporary files on error.
 * @param {string} url - The URL of the file to download.
 * @param {string} dest - The local path where the file will be saved.
 * @returns {Promise<void>} Resolves when the download is complete.
 */
const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Node.js/Pocketbase-Downloader' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return resolve(downloadFile(res.headers.location, dest))
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: ${res.statusCode}`))
      }

      const file = createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
      file.on('error', (err) => {
        fs.unlinkSync(dest)
        reject(err)
      })
    }).on('error', reject)
  })
}

/**
 * Main entry point for downloading PocketBase.
 * Detects the current platform and architecture, then downloads and extracts
 * the appropriate binary from GitHub releases.
 */
async function main() {
  const targetPlatform = getTargetPlatform()
  const targetArch = getTargetArch()
  const binaryName = getBinaryName()
  const binaryPath = `${DATABASE_DIR}/${binaryName}`

  // Ensure database directory exists
  if (!fs.existsSync(DATABASE_DIR)) {
    fs.mkdirSync(DATABASE_DIR, { recursive: true })
  }

  // Check if pocketbase already exists
  if (fs.existsSync(binaryPath)) {
    console.log(`✅ PocketBase binary already exists at ${binaryPath}. Skipping download.`)
    return
  }

  console.log(`🔍 Fetching latest PocketBase release for ${targetPlatform}_${targetArch}...`)

  try {
    const releaseInfo = await fetchJson(API_URL)

    // Find the right asset
    const assetNameSuffix = `${targetPlatform}_${targetArch}.zip`
    const asset = releaseInfo.assets.find(a => a.name.endsWith(assetNameSuffix))

    if (!asset) {
      throw new Error(`Could not find a release asset matching ${assetNameSuffix}. Available: ${releaseInfo.assets.map(a => a.name).join(', ')}`)
    }

    console.log(`⬇️ Downloading ${asset.name} from ${asset.browser_download_url}...`)

    const zipDest = `${os.tmpdir()}/${asset.name}`
    await downloadFile(asset.browser_download_url, zipDest)

    console.log(`📦 Extracting ${asset.name} into ${DATABASE_DIR}...`)
    const zip = new AdmZip(zipDest)
    zip.extractAllTo(DATABASE_DIR, true)

    // Make executable on non-windows platforms
    if (PLATFORM !== 'win32') {
      fs.chmodSync(binaryPath, 0o755)
    }

    console.log(`🗑️ Cleaning up ${zipDest}...`)
    fs.unlinkSync(zipDest)

    console.log('✅ PocketBase downloaded and extracted successfully.')
  } catch (err) {
    console.error('❌ Error downloading PocketBase:', err.message)
    process.exit(1)
  }
}

main()
