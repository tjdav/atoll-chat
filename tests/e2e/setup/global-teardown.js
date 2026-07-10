/**
 *
 */
async function globalTeardown () {
  console.log('--- Mock PocketBase Teardown ---')
  if (globalThis.__MOCK_PB_SERVER__) {
    await new Promise((resolve) => {
      globalThis.__MOCK_PB_SERVER__.close(() => {
        resolve()
      })
    })
    console.log('Mock PocketBase server stopped.')
  } else {
    console.log('No active Mock PocketBase server found to teardown.')
  }
}

export default globalTeardown
