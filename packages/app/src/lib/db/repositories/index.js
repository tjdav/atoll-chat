/**
 * Repository aggregator and factory module.
 *
 * @module @atoll/app/lib/db/repositories/index
 */

import { createUsersRepository } from './users.js'
import { createRoomsRepository } from './rooms.js'
import { createRoomMembersRepository } from './room-members.js'
import { createRoomOrderRepository } from './room-order.js'
import { createMessagesRepository } from './messages.js'
import { createAttachmentsRepository } from './attachments.js'
import { createReactionsRepository } from './reactions.js'
import { createReadStateRepository } from './read-state.js'
import { createDraftsRepository } from './drafts.js'
import { createBlockedUsersRepository } from './blocked-users.js'
import { createOutboxRepository } from './outbox.js'

/**
 * Creates and returns all domain repository instances bound to the given database.
 *
 * @param {object} params - Factory parameters.
 * @param {object} params.db - Database instance.
 * @returns {object} Object containing all repository instances.
 */
export function createRepositories({ db }) {
  return {
    users: createUsersRepository({ db }),
    rooms: createRoomsRepository({ db }),
    roomMembers: createRoomMembersRepository({ db }),
    roomOrder: createRoomOrderRepository({ db }),
    messages: createMessagesRepository({ db }),
    attachments: createAttachmentsRepository({ db }),
    reactions: createReactionsRepository({ db }),
    readState: createReadStateRepository({ db }),
    drafts: createDraftsRepository({ db }),
    blockedUsers: createBlockedUsersRepository({ db }),
    outbox: createOutboxRepository({ db })
  }
}

export {
  createUsersRepository,
  createRoomsRepository,
  createRoomMembersRepository,
  createRoomOrderRepository,
  createMessagesRepository,
  createAttachmentsRepository,
  createReactionsRepository,
  createReadStateRepository,
  createDraftsRepository,
  createBlockedUsersRepository,
  createOutboxRepository
}
