/**
 * Base class for every error raised by @atoll/bot.
 *
 * `code` is a stable machine-readable string. `message` is
 * human-readable and may change between versions.
 *
 * Spec: atoll-bot-v1.md §12.
 */
export class BotError extends Error {
  /**
   * @param {string} message - Human-readable error message.
   * @param {object} [options] - Error options.
   * @param {Error} [options.cause] - Optional cause of the error.
   */
  constructor (message, options) {
    super(message, options)
    this.name = 'BotError'
    /** @type {string} */
    this.code = 'bot_error'
  }
}

/**
 * Structural failure in `defineBot`.
 */
export class ValidationError extends BotError {
  /** @override */
  name = 'ValidationError'

  /** @override */
  code = 'validation_error'
}

/**
 * Requested capability name is unknown to the SDK.
 */
export class CapabilityUnknownError extends BotError {
  /** @override */
  name = 'CapabilityUnknownError'

  /** @override */
  code = 'capability_unknown'
}

/**
 * Operation requires a scope not declared by the bot.
 */
export class ScopeNotDeclaredError extends BotError {
  /** @override */
  name = 'ScopeNotDeclaredError'

  /** @override */
  code = 'scope_not_declared'
}

/**
 * Scope dependency is missing or unsatisfied.
 */
export class ScopeDependencyMissingError extends BotError {
  /** @override */
  name = 'ScopeDependencyMissingError'

  /** @override */
  code = 'scope_dependency_missing'
}

/**
 * Message delivery failed after retries.
 */
export class PostFailedError extends BotError {
  /** @override */
  name = 'PostFailedError'

  /** @override */
  code = 'post_failed'
}

/**
 * `reply` invoked without a target message in context.
 */
export class ReplyRequiresReplyToError extends BotError {
  /** @override */
  name = 'ReplyRequiresReplyToError'

  /** @override */
  code = 'reply_requires_reply_to'
}

/**
 * Key uses a reserved prefix (`_runtime:`).
 */
export class SettingsReservedPrefixError extends BotError {
  /** @override */
  name = 'SettingsReservedPrefixError'

  /** @override */
  code = 'settings_reserved_prefix'
}

/**
 * Setting payload failed ECDH or AES-256-GCM decrypt.
 */
export class SettingsDecryptFailedError extends BotError {
  /** @override */
  name = 'SettingsDecryptFailedError'

  /** @override */
  code = 'settings_decrypt_failed'
}

/**
 * Persisting settings to storage failed.
 */
export class SettingsWriteFailedError extends BotError {
  /** @override */
  name = 'SettingsWriteFailedError'

  /** @override */
  code = 'settings_write_failed'
}

/**
 * Key uses a reserved prefix (`_runtime:`).
 */
export class StorageReservedPrefixError extends BotError {
  /** @override */
  name = 'StorageReservedPrefixError'

  /** @override */
  code = 'storage_reserved_prefix'
}

/**
 * Per-bot storage size cap reached.
 */
export class StorageCapacityExceededError extends BotError {
  /** @override */
  name = 'StorageCapacityExceededError'

  /** @override */
  code = 'storage_capacity_exceeded'
}

/**
 * Target publisher key not in cache and lookup failed.
 */
export class PublisherKeyUnavailableError extends BotError {
  /** @override */
  name = 'PublisherKeyUnavailableError'

  /** @override */
  code = 'publisher_key_unavailable'
}

/**
 * Key signature or fingerprint check failed.
 */
export class PublisherKeyVerificationFailedError extends BotError {
  /** @override */
  name = 'PublisherKeyVerificationFailedError'

  /** @override */
  code = 'publisher_key_verification_failed'
}

/**
 * Result payload encryption failed.
 */
export class CommandResultEncryptFailedError extends BotError {
  /** @override */
  name = 'CommandResultEncryptFailedError'

  /** @override */
  code = 'command_result_encrypt_failed'
}

/**
 * Bot identity key rotation failed.
 */
export class KeyRotationFailedError extends BotError {
  /** @override */
  name = 'KeyRotationFailedError'

  /** @override */
  code = 'key_rotation_failed'
}

/**
 * Passphrase required to unlock keystore.
 */
export class KeystoreLockedError extends BotError {
  /** @override */
  name = 'KeystoreLockedError'

  /** @override */
  code = 'keystore_locked'
}

/**
 * File unreadable, bad HMAC, or truncated.
 */
export class KeystoreCorruptError extends BotError {
  /** @override */
  name = 'KeystoreCorruptError'

  /** @override */
  code = 'keystore_corrupt'
}

/**
 * Outbound requests throttled by server.
 */
export class RateLimitedError extends BotError {
  /** @override */
  name = 'RateLimitedError'

  /** @override */
  code = 'rate_limited'
}

/**
 * Secret missing for configured webhook path.
 */
export class WebhookSecretMissingError extends BotError {
  /** @override */
  name = 'WebhookSecretMissingError'

  /** @override */
  code = 'webhook_secret_missing'
}

/**
 * `X-Atoll-Signature-256` verification failed.
 */
export class WebhookSignatureInvalidError extends BotError {
  /** @override */
  name = 'WebhookSignatureInvalidError'

  /** @override */
  code = 'webhook_signature_invalid'
}
