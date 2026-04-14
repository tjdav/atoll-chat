import { definePlugin } from 'coralite'
/**
 *
 */
export default function ({
  trackerUrl = 'ws://localhost:8000'
} = {}) {
  return definePlugin({
    name: 'webtorrent-plugin',
    client: {
      config: {
        trackerUrl
      },
      imports: [{
        specifier: 'https://esm.sh/webtorrent/dist/webtorrent.min.js',
        defaultExport: 'WebTorrent'
      }],
      setup (context) {
        const WebTorrent = context.imports.WebTorrent
        const client = new WebTorrent({
          dht: false,
          lsd: false,
          webSeeds: false,
          tracker: {
            announce: [context.config.trackerUrl]
          }
        })
        return {
          client
        }
      },
      helpers: {
        seed: globalContext => localContext => {
          const client = localContext.values.client
          return file => {
            return new Promise((resolve, reject) => {
              try {
                client.seed(file, {
                  announce: [globalContext.config.trackerUrl]
                }, torrent => {
                  resolve(torrent.magnetURI)
                })
              } catch (error) {
                console.error('WebTorrent seed failed:', error)
                reject(error)
              }
            })
          }
        },
        download: globalContext => localContext => {
          const client = localContext.values.client
          return (magnetURI, onProgress) => {
            return new Promise((resolve, reject) => {
              try {
                client.add(magnetURI, {
                  announce: [globalContext.config.trackerUrl]
                }, torrent => {
                  const file = torrent.files[0]
                  if (onProgress) {
                    torrent.on('download', () => {
                      onProgress(torrent.progress)
                    })
                  }
                  file.getBlob((error, blob) => {
                    if (error) {
                      reject(error)
                      return
                    }
                    resolve(blob)
                  })
                })
              } catch (error) {
                console.error('WebTorrent download failed:', error)
                reject(error)
              }
            })
          }
        }
      }
    }
  })
}
