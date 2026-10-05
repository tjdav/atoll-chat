// Aggregator for the app's extensions.
//
// Each first-party extension has its own module under this directory
// (e.g. `chat/index.js`). The aggregator imports them and exports the
// array. `coralite.config.js` passes the array to `extensionPlugin`.
//
// C-CHAT-3 ships with an empty array. C-CHAT-4 populates it with the
// first-party extensions.

export const extensions = []
