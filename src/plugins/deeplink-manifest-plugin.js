import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { definePlugin } from 'coralite'

/**
 * Build-time plugin to generate apple-app-site-association and assetlinks.json
 *
 * @param {Object} config Configurations passed to the plugin creator.
 * @returns {Object} The Coralite plugin definition.
 */
export default function (config) {
  return definePlugin({
    name: 'deeplinkManifestGenerator',
    server: {
      /**
       * Runs after build to write the deep linking association files to .well-known/
       *
       * @param {Object} buildContext Context containing the app instance.
       * @param {Object} buildContext.app The application instance.
       * @returns {Promise<void>} Resolves when files are written.
       */
      onAfterBuild: async ({ app }) => {
        const outputDir = app.options.output
        if (!outputDir) {
          return
        }

        const wellKnownDir = join(outputDir, '.well-known')
        await mkdir(wellKnownDir, { recursive: true })

        const iosTeamId = config?.iosTeamId || process.env.ATOLL_IOS_TEAM_ID || 'TEAMID1234'
        const iosAppId = config?.iosAppId || process.env.ATOLL_IOS_APP_ID || 'com.atoll.chat'
        const aasaContent = {
          applinks: {
            details: [
              {
                appIDs: [`${iosTeamId}.${iosAppId}`],
                components: [
                  { '/': '/invite/*' },
                  { '/': '/auth/*' }
                ]
              }
            ]
          }
        }

        const destAasaPath = join(wellKnownDir, 'apple-app-site-association')
        await writeFile(destAasaPath, JSON.stringify(aasaContent, null, 2))
        app.trackOutputFile(destAasaPath)

        const packageName = config?.androidPackageName || process.env.ATOLL_ANDROID_PACKAGE_NAME || 'com.atoll.chat'
        const fingerprint = config?.androidCertFingerprint || process.env.ATOLL_ANDROID_CERT_FINGERPRINT || 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C'
        const assetlinksContent = [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: packageName,
              sha256_cert_fingerprints: [fingerprint]
            }
          }
        ]

        const destAssetlinksPath = join(wellKnownDir, 'assetlinks.json')
        await writeFile(destAssetlinksPath, JSON.stringify(assetlinksContent, null, 2))
        app.trackOutputFile(destAssetlinksPath)
      }
    }
  })
}
