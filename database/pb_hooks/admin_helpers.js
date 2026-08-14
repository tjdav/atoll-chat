// database/pb_hooks/admin_helpers.js

/**
 * Counts the number of rows in a database table matching an optional query expression.
 *
 * Genuine database failures propagate so callers fail closed instead of silently defaulting to zero.
 *
 * @param {string} table - The name of the database table or collection.
 * @param {import("dbx").Expression} [condition] - Optional dbx query filter expression.
 * @returns {number} The total count of matching rows.
 * @throws {Error} If the database query fails unexpectedly.
 */
function countTable (table, condition) {
  const dm = new DynamicModel({ count: 0 })
  let query = $app.db().select('count(*) as count').from(table)
  if (condition) {
    query = query.where(condition)
  }
  query.one(dm)
  return dm.count
}

/**
 * Loads the singleton `app_metadata` record.
 *
 * @returns {core.Record} The fetched metadata record.
 * @throws {BadRequestError} If no `app_metadata` record exists.
 */
function getAppMetadata () {
  const records = $app.findRecordsByFilter('app_metadata', '1=1', '', 1, 0)
  if (records.length === 0) {
    throw new BadRequestError('App metadata record not found.')
  }
  return records[0]
}

/**
 * Returns the trust record for the given user, lazily creating standard or owner defaults if absent.
 *
 * The first registered account on the instance is promoted to owner; database failures
 * propagate so elevated ownership is never granted by accident (fail closed).
 *
 * @param {string} userId - The unique ID of the target user record.
 * @returns {core.Record} The existing or freshly created `user_trust` record.
 * @throws {Error} If database querying or record creation fails.
 */
function getOrCreateTrust (userId) {
  const existing = $app.findRecordsByFilter('user_trust', 'user = {:userId}', '', 1, 0, { userId })
  if (existing.length > 0) {
    return existing[0]
  }

  const firstUsers = $app.findRecordsByFilter('users', '1=1', 'created', 1, 0)
  const isFirst = firstUsers.length > 0 && firstUsers[0].id === userId
  const collection = $app.findCollectionByNameOrId('user_trust')
  const trustRecord = new Record(collection)
  trustRecord.set('user', userId)
  trustRecord.set('tier', isFirst ? 'owner' : 'standard')
  trustRecord.set('invite_quota', isFirst ? 999999 : 0)
  trustRecord.set('invites_revoked', false)
  $app.save(trustRecord)
  return trustRecord
}

/**
 * Middleware helper that ensures the requesting user is authenticated and holds the 'owner' trust tier.
 *
 * @param {core.RequestEvent} e - The PocketBase router context event object.
 * @returns {void}
 * @throws {ForbiddenError} If the request is unauthenticated or the user lacks the owner tier.
 */
function enforceOwner (e) {
  const authRecord = e.auth
  if (!authRecord) {
    throw new ForbiddenError('Only authenticated owners can access this endpoint.')
  }

  const trust = getOrCreateTrust(authRecord.id)
  if (trust.get('tier') !== 'owner') {
    throw new ForbiddenError('Only authenticated owners can access this endpoint.')
  }
}

module.exports = {
  countTable,
  getAppMetadata,
  getOrCreateTrust,
  enforceOwner
}
