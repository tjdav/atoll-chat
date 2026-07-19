// database/pb_hooks/s3_config.pb.js

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

  const s3Endpoint = getEnv('ATOLL_S3_ENDPOINT')
  const s3Bucket = getEnv('ATOLL_S3_BUCKET')
  const s3AccessKey = getEnv('ATOLL_S3_ACCESS_KEY')
  const s3SecretKey = getEnv('ATOLL_S3_SECRET_KEY')
  const s3Region = getEnv('ATOLL_S3_REGION') || 'us-east-1'
  const forcePathStyle = getEnv('ATOLL_S3_FORCE_PATH_STYLE') === 'true'

  const settings = e.app.settings()
  const s3 = settings.s3

  if (s3) {
    if (s3Endpoint && s3Bucket && s3AccessKey && s3SecretKey) {
      s3.enabled = true
      s3.endpoint = s3Endpoint
      s3.bucket = s3Bucket
      s3.accessKey = s3AccessKey
      s3.secret = s3SecretKey
      s3.region = s3Region
      s3.forcePathStyle = forcePathStyle
    } else {
      s3.enabled = false
    }
    e.app.save(settings)
  }
})
