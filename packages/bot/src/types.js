/* eslint-disable jsdoc/no-undefined-types */

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

/** @typedef {{ fileId: string | null, emoji: string | null }} Avatar */

/** @typedef {{ id: string, displayName: string | null, memberCount: number }} RoomRef */

/** @typedef {{ id: string, roomId: string, createdAt: string }} MessageRef */

/** @typedef {{ fileId: string, size: number, contentType: string, thumbnailFileId?: string }} AttachmentRef */

/** @typedef {object} SettingDecl
 * @property {string} label
 * @property {SettingKind} type
 * @property {'user' | 'room'} [scope]
 * @property {true} [required]
 * @property {unknown} [default]
 * @property {string[]} [options]
 * @property {string} [placeholder]
 * @property {string} [hint]
 */

/**
 * Maps a setting declaration's `type` literal to its value type.
 * @template D
 * @typedef {D extends { type: 'secret' } ? string : D extends { type: 'text' } ? string : D extends { type: 'number' } ? number : D extends { type: 'boolean' } ? boolean : D extends { type: 'select' } ? string : D extends { type: 'multiselect' } ? string[] : D extends { type: 'room-select' } ? string : D extends { type: 'user-select' } ? string : D extends { type: 'time-range' } ? { start: string, end: string } : D extends { type: 'duration' } ? number : D extends { type: 'color' } ? string : D extends { type: 'file' } ? string : never} SettingValue
 */

/** @typedef {Record<string, SettingDecl>} SettingsDecl */

/** @typedef {object} ArgDecl
 * @property {ArgKind} type
 * @property {true} [required]
 * @property {string[]} [options]
 * @property {string} [description]
 */

/** @template D
 * @typedef {D extends { type: 'string' } ? string : D extends { type: 'number' } ? number : D extends { type: 'boolean' } ? boolean : D extends { type: 'select' } ? string : never} ArgValue
 */

/** @template D
 * @typedef {D extends { required: true } ? ArgValue<D> : ArgValue<D> | undefined} ArgOf */

/** @template {Record<string, ArgDecl>} D
 * @typedef {object} ArgsReader
 * @property {<K extends keyof D & string>(key: K) => ArgOf<D[K]>} get */

/** @typedef {{ type: 'local_message', content: string } | { type: 'room_message', content: string, attachments?: AttachmentRef[], replyTo?: string } | { type: 'toast', content: string } | { type: 'panel', content: string } | { type: 'none' }} CommandResult */

/** @typedef {object} WebhookTrigger
 * @property {'webhook'} type
 * @property {string} path
 * @property {'POST' | 'PUT' | 'PATCH'} [method]
 * @property {string} [secret]
 * @property {string} [idempotency]
 * @property {number} [retries]
 * @property {number} [retryDelayMs]
 */

/** @typedef {object} ScheduleTrigger
 * @property {'schedule'} type
 * @property {string} name
 * @property {string} cron
 * @property {string} [timezone]
 */

/** @typedef {WebhookTrigger | ScheduleTrigger} TriggerDecl */

/** @template {Record<string, SettingDecl>} S
 * @typedef {object} SettingsStore
 * @property {<K extends keyof S & string>(key: K, opts?: { room?: string }) => Promise<SettingValue<S[K]> | undefined>} get
 * @property {<K extends keyof S & string>(key: K, value: SettingValue<S[K]>, opts?: { room?: string }) => Promise<void>} set
 * @property {(key: string, opts?: { room?: string }) => Promise<void>} delete
 * @property {<K extends keyof S & string>(key: K, cb: (value: SettingValue<S[K]> | undefined) => void, opts?: { room?: string }) => () => void} subscribe */

/** @typedef {object} StorageStore
 * @property {(key: string) => Promise<unknown>} get
 * @property {(key: string, value: unknown) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 * @property {() => Promise<void>} clear */

/** @typedef {object} RoomsStore
 * @property {() => Promise<RoomRef[]>} list
 * @property {(roomId: string) => Promise<RoomRef | null>} get */

/** @typedef {object} PostOptions
 * @property {string} [roomId]
 * @property {string} [text]
 * @property {AttachmentRef[]} [attachments]
 * @property {string} [replyTo] */

/** @typedef {PostOptions & { replyTo: string }} ReplyOptions */

/** @typedef {object} LocalOptions
 * @property {string} text
 * @property {'text' | 'markdown'} [format] */

/**
 * Invocation context. Reconstructed per handler call. Not a stable
 * identity. Fields are populated per invocation kind and derived mode.
 *
 * @template {Record<string, SettingDecl>} [S=Record<string, SettingDecl>]
 * @typedef {object} BotCtx
 * @property {{ id: string, label: string, ownerUserId: string, avatar: Avatar }} bot
 * @property {{ roomId: string, mode: Mode, scopes: Capability[] } | null} grant
 * @property {RoomRef | null} room
 * @property {{ id: string, type: string, roomId: string | null, timestamp: string } | null} event
 * @property {SettingsStore<S>} settings
 * @property {StorageStore} storage
 * @property {RoomsStore} rooms
 * @property {(opts: PostOptions) => Promise<MessageRef>} post
 * @property {(opts: ReplyOptions) => Promise<MessageRef>} reply
 * @property {(opts: LocalOptions) => Promise<void>} sendLocal
 * @property {(level: LogLevel, message: string, meta?: object) => void} log
 * @property {(url: string, opts?: RequestInit) => Promise<Response>} fetch
 * @property {(url: string, opts?: RequestInit) => Promise<Response>} fetchUserUrl
 * @property {AbortSignal} signal
 * @property {(path: string) => Promise<string>} uploadAvatar */

/** @typedef {object} MessageDataMember
 * @property {string} id
 * @property {string} senderUserId
 * @property {string} senderClientId
 * @property {string} createdAt
 * @property {string | null} plaintext
 * @property {AttachmentRef[]} attachments
 * @property {string | null} replyTo */

/** @typedef {object} MessageDataObserver
 * @property {string} id
 * @property {string} senderUserId
 * @property {string} senderClientId
 * @property {string} createdAt
 * @property {number} sizeBytes */

/** @typedef {object} MessageDataDeleted
 * @property {string} id */

/** @typedef {object} MessageEvent
 * @property {string} id
 * @property {'message.new' | 'message.edited' | 'message.deleted'} type
 * @property {string} roomId
 * @property {string} timestamp
 * @property {MessageDataMember | MessageDataObserver | MessageDataDeleted} data */

/** @template {Record<string, SettingDecl>} S
 * @typedef {object} HandlerMap
 * @property {(ctx: BotCtx<S>) => void | Promise<void>} [install]
 * @property {(ctx: BotCtx<S>) => void | Promise<void>} [uninstall]
 * @property {(ctx: BotCtx<S>, event: { botId: string, roomId: string, oldMode: Mode, newMode: Mode, scopes: Capability[], changed: string[] }) => void | Promise<void>} [grantUpdated]
 * @property {(ctx: BotCtx<S>, event: MessageEvent) => void | Promise<void>} [message]
 * @property {(ctx: BotCtx<S>, event: { id: string, type: string, roomId: string, timestamp: string, data: object }) => void | Promise<void>} [room]
 * @property {(ctx: BotCtx<S>, payload: { path: string, body: string, headers: Record<string, string> }) => void | Promise<void>} [webhook]
 * @property {(ctx: BotCtx<S>, payload: { name: string }) => void | Promise<void>} [schedule] */

/** @template {Record<string, ArgDecl>} D
 * @template {Record<string, SettingDecl>} S
 * @typedef {object} CommandDecl
 * @property {string} [description]
 * @property {D} args
 * @property {(ctx: BotCtx<S>, args: ArgsReader<D>) => CommandResult | Promise<CommandResult>} handler */

/** @template {Record<string, SettingDecl>} S
 * @template {Record<string, CommandDecl<any, any>>} C
 * @template {readonly TriggerDecl[]} T
 * @typedef {object} BotConfig
 * @property {string} id
 * @property {string} apiVersion
 * @property {string} hostApi
 * @property {string} label
 * @property {Capability[]} capabilities
 * @property {Avatar} [avatar]
 * @property {S} [settings]
 * @property {C} [commands]
 * @property {T} [triggers]
 * @property {HandlerMap<S>} handlers */

/** @template {Record<string, SettingDecl>} S
 * @template {Record<string, CommandDecl<any, any>>} C
 * @template {readonly TriggerDecl[]} T
 * @typedef {object} Bot
 * @property {BotConfig<S, C, T>} config */
