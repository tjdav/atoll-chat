import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'webtorrent-plugin',
  client: {
    imports: [
      {
        specifier: 'https://esm.sh/webtorrent/dist/webtorrent.min.js',
        defaultExport: 'WebTorrent'
      }
    ],
    setup (context) {
      const WebTorrent = context.imports.WebTorrent
      const client = new WebTorrent()

      return {
        client
      }
    },
    helpers: {
      seed: (context) => {
        const client = context.values.client

        return (file) => {
          return new Promise((resolve, reject) => {
            try {
              client.seed(file, (torrent) => {
                resolve(torrent.magnetURI)
              })
            } catch (error) {
              console.error('WebTorrent seed failed:', error)
              reject(error)
            }
          })
        }
      },
      download: (context) => {
        const client = context.values.client

        return (magnetURI) => {
          return new Promise((resolve, reject) => {
            try {
              client.add(magnetURI, (torrent) => {
                const file = torrent.files[0]

                file.getBlob((err, blob) => {
                  if (err) {
                    reject(err)
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
