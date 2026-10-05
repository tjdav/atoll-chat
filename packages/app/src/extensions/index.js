// Aggregator for the app's extensions.
//
// Each first-party extension has its own module under this directory
// (e.g. `chat/index.js`). The aggregator imports them and exports the
// array. `coralite.config.js` passes the array to `extensionPlugin`.

import chat from './chat/index.js'
import media from './media/index.js'
import documents from './documents/index.js'
import links from './links/index.js'
import calls from './calls/index.js'
import settings from './settings/index.js'
import hangouts from './hangouts/index.js'
import profile from './profile/index.js'
import join from './join/index.js'
import admin from './admin/index.js'

/**
 * Array of first-party extensions registered with the host application.
 *
 * @type {Array<import('@atoll/extend').NormalizedExtension>}
 */
export const extensions = [
  chat,
  media,
  documents,
  links,
  calls,
  settings,
  hangouts,
  profile,
  join,
  admin
]
