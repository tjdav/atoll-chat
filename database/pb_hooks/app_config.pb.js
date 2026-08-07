// database/pb_hooks/app_config.pb.js

onBootstrap((e) => {
  e.next()

  /**
   * Retrieves the value of the environment variable named by the key.
   *
   * @param {string} key - The environment variable name.
   * @returns {string|undefined} The environment variable value or undefined if not present.
   */
  function getEnv (key) {
    if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
      return process.env[key]
    }

    if (typeof $os !== 'undefined' && typeof $os.getenv === 'function') {
      return $os.getenv(key)
    }

    return undefined
  }

  const settings = e.app.settings()
  const meta = settings.meta

  if (meta) {
    meta.appName = 'Atoll Chat'

    const appUrl = getEnv('ATOLL_APP_URL')
    if (appUrl) {
      meta.appURL = appUrl
    }

    e.app.save(settings)
  }
})
