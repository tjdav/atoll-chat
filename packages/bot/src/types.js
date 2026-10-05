/**
 * The eight capability scopes a bot may declare.
 * @typedef {'post_message' | 'post_attachment' | 'post_reaction' | 'read_commands' | 'read_metadata' | 'read_content' | 'edit_message' | 'delete_message'} Capability
 */

/**
 * Derived per-room mode. Never authored, never displayed.
 * @typedef {'write_only' | 'observer' | 'member'} Mode
 */

/**
 * Setting field types.
 * @typedef {'text' | 'secret' | 'number' | 'boolean' | 'select' | 'multiselect' | 'room-select' | 'user-select' | 'time-range' | 'duration' | 'color' | 'file'} SettingKind
 */

/**
 * Command argument types.
 * @typedef {'string' | 'number' | 'boolean' | 'select'} ArgKind
 */

/** @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel */

/**
 * @typedef {object} Avatar
 * @property {string | null} fileId - The file ID of the avatar image.
 * @property {string | null} emoji - The fallback emoji identifier.
 */

/**
 * @typedef {object} RoomRef
 * @property {string} id - The unique room identifier.
 * @property {string | null} displayName - The display name of the room.
 * @property {number} memberCount - The number of active members in the room.
 */

/**
 * @typedef {object} MessageRef
 * @property {string} id - The unique message identifier.
 * @property {string} roomId - The ID of the room where the message was sent.
 * @property {string} createdAt - The ISO timestamp when the message was created.
 */

/**
 * @typedef {object} AttachmentRef
 * @property {string} fileId - The storage file ID for the attachment.
 * @property {number} size - The size of the attachment in bytes.
 * @property {string} contentType - The MIME content type of the attachment.
 * @property {string} [thumbnailFileId] - The optional thumbnail file ID.
 */

/**
 * @typedef {object} SettingDecl
 * @property {string} label - The human-readable setting label.
 * @property {SettingKind} type - The input control type for the setting.
 * @property {'user' | 'room'} [scope] - The storage scope of the setting.
 * @property {true} [required] - Whether the setting is required.
 * @property {unknown} [default] - Default value for the setting.
 * @property {string[]} [options] - Allowed options for select or multiselect fields.
 * @property {string} [placeholder] - Placeholder text for text or secret inputs.
 * @property {string} [hint] - Optional help text displayed beneath the field.
 */

/**
 * Maps a setting declaration's `type` literal to its value type.
 * @template D - The setting declaration type.
 * @typedef {D extends { type: 'secret' } ? string : D extends { type: 'text' } ? string : D extends { type: 'number' } ? number : D extends { type: 'boolean' } ? boolean : D extends { type: 'select' } ? string : D extends { type: 'multiselect' } ? string[] : D extends { type: 'room-select' } ? string : D extends { type: 'user-select' } ? string : D extends { type: 'time-range' } ? { start: string, end: string } : D extends { type: 'duration' } ? number : D extends { type: 'color' } ? string : D extends { type: 'file' } ? string : never} SettingValue
 */

/** @typedef {Record<string, SettingDecl>} SettingsDecl */

/**
 * @typedef {object} ArgDecl
 * @property {ArgKind} type - The argument's value type.
 * @property {true} [required] - When true, the argument must be supplied.
 * @property {string[]} [options] - Allowed values when type is 'select'.
 * @property {string} [description] - Human-readable hint shown in the palette.
 */

/**
 * @template D - The argument declaration.
 * @typedef {D extends { type: 'string' } ? string : D extends { type: 'number' } ? number : D extends { type: 'boolean' } ? boolean : D extends { type: 'select' } ? string : never} ArgValue
 */

/**
 * @template D - The argument declaration.
 * @typedef {D extends { required: true } ? ArgValue<D> : ArgValue<D> | undefined} ArgOf
 */

/**
 * @template {Record<string, ArgDecl>} D - The argument declaration dictionary.
 * @typedef {object} ArgsReader
 * @property {<K extends keyof D & string>(key: K) => ArgOf<D[K]>} get - Reads an argument value by key.
 */

/** @typedef {{ type: 'local_message', content: string } | { type: 'room_message', content: string, attachments?: AttachmentRef[], replyTo?: string } | { type: 'toast', content: string } | { type: 'panel', content: string } | { type: 'none' }} CommandResult */

/**
 * @typedef {object} WebhookTrigger
 * @property {'webhook'} type - The webhook trigger discriminator.
 * @property {string} path - The HTTP endpoint path segment for incoming webhooks.
 * @property {'POST' | 'PUT' | 'PATCH'} [method] - The expected HTTP method.
 * @property {string} [secret] - The shared secret header for signature verification.
 * @property {string} [idempotency] - Header name for idempotency deduplication.
 * @property {number} [retries] - Number of delivery retry attempts.
 * @property {number} [retryDelayMs] - Delay between retries in milliseconds.
 */

/**
 * @typedef {object} ScheduleTrigger
 * @property {'schedule'} type - The schedule trigger discriminator.
 * @property {string} name - Unique identifier name for the schedule.
 * @property {string} cron - Cron expression schedule pattern.
 * @property {string} [timezone] - Optional IANA timezone identifier.
 */

/** @typedef {WebhookTrigger | ScheduleTrigger} TriggerDecl */

/**
 * @template {Record<string, SettingDecl>} S - The settings declaration map.
 * @typedef {object} SettingsStore
 * @property {<K extends keyof S & string>(key: K, opts?: { room?: string }) => Promise<SettingValue<S[K]> | undefined>} get - Retrieves a setting value.
 * @property {<K extends keyof S & string>(key: K, value: SettingValue<S[K]>, opts?: { room?: string }) => Promise<void>} set - Stores a setting value.
 * @property {(key: string, opts?: { room?: string }) => Promise<void>} delete - Deletes a setting value.
 * @property {<K extends keyof S & string>(key: K, cb: (value: SettingValue<S[K]> | undefined) => void, opts?: { room?: string }) => () => void} subscribe - Subscribes to setting value updates.
 */

/**
 * @typedef {object} StorageStore
 * @property {(key: string) => Promise<unknown>} get - Retrieves a persistent key-value record.
 * @property {(key: string, value: unknown) => Promise<void>} set - Stores a persistent key-value record.
 * @property {(key: string) => Promise<void>} delete - Deletes a persistent key-value record.
 * @property {() => Promise<void>} clear - Removes all persistent records for this bot.
 */

/**
 * @typedef {object} RoomsStore
 * @property {() => Promise<RoomRef[]>} list - Lists available rooms.
 * @property {(roomId: string) => Promise<RoomRef | null>} get - Retrieves details for a specific room.
 */

/**
 * @typedef {object} PostOptions
 * @property {string} [roomId] - Target room ID.
 * @property {string} [text] - Text content of the message.
 * @property {AttachmentRef[]} [attachments] - List of attachment references.
 * @property {string} [replyTo] - ID of the message being replied to.
 */

/** @typedef {PostOptions & { replyTo: string }} ReplyOptions */

/**
 * @typedef {object} LocalOptions
 * @property {string} text - The local message body.
 * @property {'text' | 'markdown'} [format] - Text formatting syntax.
 */

/**
 * Invocation context. Reconstructed per handler call. Not a stable
 * identity. Fields are populated per invocation kind and derived mode.
 *
 * @template {Record<string, SettingDecl>} [S=Record<string, SettingDecl>] - The settings declaration map.
 * @typedef {object} BotCtx
 * @property {{ id: string, label: string, ownerUserId: string, avatar: Avatar }} bot - Information about the bot identity.
 * @property {{ roomId: string, mode: Mode, scopes: Capability[] } | null} grant - Grant information for the target room.
 * @property {RoomRef | null} room - Target room metadata.
 * @property {{ id: string, type: string, roomId: string | null, timestamp: string } | null} event - Triggering event metadata.
 * @property {SettingsStore<S>} settings - Interface for accessing bot settings.
 * @property {StorageStore} storage - Interface for key-value storage.
 * @property {RoomsStore} rooms - Interface for querying rooms.
 * @property {(opts: PostOptions) => Promise<MessageRef>} post - Posts a message to a room.
 * @property {(opts: ReplyOptions) => Promise<MessageRef>} reply - Replies to a message in a room.
 * @property {(opts: LocalOptions) => Promise<void>} sendLocal - Sends a local client-only message.
 * @property {(level: LogLevel, message: string, meta?: object) => void} log - Emits a log entry.
 * @property {(url: string, opts?: RequestInit) => Promise<Response>} fetch - Fetches external resources using the bot's egress proxy.
 * @property {(url: string, opts?: RequestInit) => Promise<Response>} fetchUserUrl - Fetches user-provided links safely.
 * @property {AbortSignal} signal - AbortSignal tied to the handler invocation timeout.
 * @property {(path: string) => Promise<string>} uploadAvatar - Uploads a new avatar file.
 */

/**
 * @typedef {object} MessageDataMember
 * @property {string} id - The message identifier.
 * @property {string} senderUserId - User ID of the sender.
 * @property {string} senderClientId - Client/device ID of the sender.
 * @property {string} createdAt - Message creation ISO timestamp.
 * @property {string | null} plaintext - Decrypted message text content.
 * @property {AttachmentRef[]} attachments - Attached file references.
 * @property {string | null} replyTo - ID of the message being replied to.
 */

/**
 * @typedef {object} MessageDataObserver
 * @property {string} id - The message identifier.
 * @property {string} senderUserId - User ID of the sender.
 * @property {string} senderClientId - Client/device ID of the sender.
 * @property {string} createdAt - Message creation ISO timestamp.
 * @property {number} sizeBytes - Encrypted payload size in bytes.
 */

/**
 * @typedef {object} MessageDataDeleted
 * @property {string} id - The deleted message identifier.
 */

/**
 * A message event delivered to the bot's `message` handler.
 * @interface MessageEvent
 * @property {string} id - Event identifier.
 * @property {'message.new' | 'message.edited' | 'message.deleted'} type - Event type discriminator.
 * @property {string} roomId - Room identifier.
 * @property {string} timestamp - ISO timestamp of the event.
 * @property {MessageDataMember | MessageDataObserver | MessageDataDeleted} data - Event payload.
 */

/**
 * @template {Record<string, SettingDecl>} S - The settings declaration map.
 * @typedef {object} HandlerMap
 * @property {(ctx: BotCtx<S>) => void | Promise<void>} [install] - Invoked when the bot is installed.
 * @property {(ctx: BotCtx<S>) => void | Promise<void>} [uninstall] - Invoked when the bot is uninstalled.
 * @property {(ctx: BotCtx<S>, event: { botId: string, roomId: string, oldMode: Mode, newMode: Mode, scopes: Capability[], changed: string[] }) => void | Promise<void>} [grantUpdated] - Invoked when bot permissions or room modes change.
 * @property {(ctx: BotCtx<S>, event: MessageEvent) => void | Promise<void>} [message] - Invoked when a message is received in a room.
 * @property {(ctx: BotCtx<S>, event: { id: string, type: string, roomId: string, timestamp: string, data: object }) => void | Promise<void>} [room] - Invoked on room events.
 * @property {(ctx: BotCtx<S>, payload: { path: string, body: string, headers: Record<string, string> }) => void | Promise<void>} [webhook] - Invoked on incoming HTTP webhooks.
 * @property {(ctx: BotCtx<S>, payload: { name: string }) => void | Promise<void>} [schedule] - Invoked on cron schedule ticks.
 */

/**
 * @template {Record<string, ArgDecl>} D - The argument declaration map.
 * @template {Record<string, SettingDecl>} S - The settings declaration map.
 * @typedef {object} CommandDecl
 * @property {string} [description] - Human-readable description of the command.
 * @property {D} args - Argument declarations map.
 * @property {(ctx: BotCtx<S>, args: ArgsReader<D>) => CommandResult | Promise<CommandResult>} handler - Command execution handler function.
 */

/**
 * @template {Record<string, SettingDecl>} S - The settings declaration map.
 * @template {Record<string, CommandDecl<any, any>>} C - The commands collection.
 * @template {readonly TriggerDecl[]} T - The triggers tuple.
 * @typedef {object} BotConfig
 * @property {string} id - The bot identifier.
 * @property {string} apiVersion - Bot SDK API version compatibility.
 * @property {string} hostApi - Host platform API version.
 * @property {string} label - Human-readable label for the bot.
 * @property {Capability[]} capabilities - Declared bot capability scopes.
 * @property {Avatar} [avatar] - Default avatar declaration.
 * @property {S} [settings] - Declared setting fields.
 * @property {C} [commands] - Declared command map.
 * @property {T} [triggers] - Declared trigger list.
 * @property {HandlerMap<S>} handlers - Bot lifecycle and event handlers.
 */

/**
 * @template {Record<string, SettingDecl>} S - The settings declaration map.
 * @template {Record<string, CommandDecl<any, any>>} C - The commands collection.
 * @template {readonly TriggerDecl[]} T - The triggers tuple.
 * @typedef {object} Bot
 * @property {BotConfig<S, C, T>} config - The bot configuration object.
 */
