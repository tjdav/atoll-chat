import { createServer } from './mock-pb-server.js'

/**
 *
 */
async function globalSetup () {
  console.log('--- Mock PocketBase Setup ---')
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.listen(8090, '127.0.0.1', (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
  console.log('Mock PocketBase server is running on http://127.0.0.1:8090')
  globalThis.__MOCK_PB_SERVER__ = server
}

export default globalSetup
