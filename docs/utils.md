# Utils Plugin Documentation

This document describes the utilities plugin, which provides common helper functions organized into namespaces injected onto the Coralite client/component context.

## Namespace Integration

The `utilsPlugin` ([utils-plugin.js](/src/plugins/utils-plugin.js)) registers helper functions grouped into namespaces. When a component initializes, these namespaces are destructured from the `utils` plugin object.

### Usage Example

To access the utility helpers inside a Coralite component:

```javascript
import { defineComponent } from 'coralite'

export default defineComponent({
  client: ({ utils }) => {
    // Destructure the required namespaces
    const { $time, $string, $list, $func, $crypto, $media, $device, $url } = utils

    // Example: Convert a timestamp
    const relativeTime = $time.getRelative(timestamp)
    
    // Example: Truncate a message preview
    const preview = $string.truncate(messageText, 30)

    // Example: Normalize a URL
    const cleanUrl = $url.normalizeUrl('http://example.com/', '/path')
  }
})
```

---

## Utility Namespaces

### Time Helpers (`$time`)
Provides relative time calculations and duration formatting.

| Function | Description | Arguments | Returns |
|---|---|---|---|
| `getRelative(timestamp)` | Converts exact database timestamps to abbreviated relative formats. | `timestamp`: `string \| Date \| number` - The timestamp to convert. | `string` - Abbreviated relative time (e.g., `'now'`, `'5m'`, `'2h'`, `'3d'`, `'1w'`, `'2y'`) or empty string `''` if invalid/missing. |
| `formatDuration(seconds)` | Formats duration in seconds to a human-readable `M:SS` or `H:MM:SS` string. | `seconds`: `number` - Duration in seconds. | `string` - Formatted duration string (e.g., `'0:00'`, `'1:05'`, `'2:14:05'`). |

### String Helpers (`$string`)
Provides safe string truncation helpers.

| Function | Description | Arguments | Returns |
|---|---|---|---|
| `truncate(str, limit)` | Safely bounds strings with an ellipsis based on a character limit. | `str`: `string` - The input string.<br>`limit`: `number` - Character threshold limit (defaults to `160`). | `string` - The truncated string with `'...'` appended if it exceeds the limit, or the original string. |

### List Manager Helpers (`$list`)
Provides paginated list management, scroll state preservation, rendering pagination triggers, and client-side searching.

| Function | Description | Arguments | Returns |
|---|---|---|---|
| `createManager(options)` | Creates a list manager instance to coordinate database cursor loops, debounced rendering, and automatic scroll position restoration/saving. | `options`: `object` - Configuration parameters (see details below). | `object` - `{ manager, debouncedRender, debouncedSaveScroll }` (see detailed API below). |

#### List Manager Options (`options`):
- `fetchNextBatch` (`function`): Async function `async (lastItem) => Promise<{ items, last }>` to fetch the next batch of items.
- `render` (`function`): Async function `async (itemsToDisplay, query) => Promise<void>` called to render the list elements.
- `scrollRoot` (`HTMLElement`): The scrollable container DOM element.
- `state` (`object`): The local component state object.
- `utils` (`object`): The utils plugin object (exposes `$func`).
- `globalStore` (`object`): The global store instance (exposes `$state`).
- `bus` (`object`): The global event bus instance (exposes `$bus`).
- `listId` (`string`): A unique string ID to store and retrieve the list's scroll position.
- `Fuse` (`class`): The Fuse constructor used for searching.
- `searchKeys` (`string[]`): Optional. Keys to search on using Fuse. Defaults to `['searchContent']`.

#### Returned Objects:
- `manager` (`object`):
  - `loadedItems` (`array`): Getter/setter for the list of loaded items.
  - `lastItem` (`any`): Getter/setter for the cursor/last item loaded.
  - `hasMore` (`boolean`): Getter/setter indicating if there are more items to fetch.
  - `fetch()` (`Promise<void>`): Initiates a fetch of the next batch and filters out duplicate items based on IDs.
  - `performRender()` (`Promise<void>`): Triggers filtering (using Fuse search if a query exists) and invokes the `render` function, then restores scroll position if applicable.
  - `saveScroll()` (`void`): Saves the current `scrollTop` of the `scrollRoot` to the global state under `listScrollPositions[listId]`.
  - `reset()` (`void`): Resets the manager state (clears loaded items, sets `hasMore` to true, clears search indexes).
- `debouncedRender` (`function`): Debounced call to `manager.performRender` (50ms delay).
- `debouncedSaveScroll` (`function`): Debounced call to `manager.saveScroll` (100ms delay).

### Function Helpers (`$func`)
Provides utility helpers for function execution control.

| Function | Description | Arguments | Returns |
|---|---|---|---|
| `debounce(fn, wait)` | Creates a debounced function that delays invoking `fn` until after `wait` milliseconds. | `fn`: `function` - The function to debounce.<br>`wait`: `number` - The delay in milliseconds. | `function` - The debounced version of the function. |

### Cryptography Helpers (`$crypto`)
Provides native browser-based encoding, decoding, and byte conversion helpers. Does not contain Libsodium functions.

| Function | Description | Arguments | Returns |
|---|---|---|---|
| `toBase64(uint8Array)` | Encodes a Uint8Array to a Base64 string. | `uint8Array`: `Uint8Array` - The byte array. | `string` - Base64 encoded string. |
| `fromBase64(base64)` | Decodes a Base64 string to a Uint8Array. | `base64`: `string` - The Base64 string. | `Uint8Array` - Decoded byte array. |
| `toUint8Array(str)` | Converts a UTF-8 string to a Uint8Array using native `TextEncoder`. | `str`: `string` - The input string. | `Uint8Array` - Encoded byte array. |
| `toString(uint8Array)` | Converts a Uint8Array back to a UTF-8 string using native `TextDecoder`. | `uint8Array`: `Uint8Array` - The byte array. | `string` - Decoded UTF-8 string. |

### Media Helpers (`$media`)
Provides decryption and caching wrapper for encrypted media assets stored in PocketBase, as well as audio waveform generation tools.

| Function | Description | Arguments | Returns |
|---|---|---|---|
| `decrypt(asset, signal)` | Fetches an encrypted media asset from PocketBase, decrypts it using the cryptographic background worker, caches the result locally, and returns an Object URL. | `asset`: `object` - The asset metadata (see below).<br>`signal`: `AbortSignal` - Optional signal to cancel fetch or decryption. | `Promise<string>` - Resolves to a decrypted local Object URL. |
| `generateWaveform(file)` | Generates a theme-aware SVG waveform for an audio file. Decodes the audio data using the Web Audio API to extract peaks and returns a SVG data URI. | `file`: `File` - The audio file to process (must be under 20MB). | `Promise<string \| null>` - Resolves to a theme-aware SVG data URI (`'data:image/svg+xml;utf8,...'`) with `fill="currentColor"`, or `null` if invalid, too large, or failed. |

#### Asset Object Properties (`asset`):
- `media_id` (`string`): Required. PocketBase media record ID.
- `file_nonce` (`string`): Required. Cryptographic nonce used to decrypt the file.
- `file_key` (`string`): Required. Cryptographic key used to decrypt the file.
- `mime_type` (`string`): Required. MIME type of the file (e.g., `'image/webp'`).
- `message_id` (`string`): Optional. Message ID used for local cache lookup/storage.
- `id` (`string`): Optional. Asset ID used for local cache lookup/storage.

### Device Helpers (`$device`)
Provides hardware and browser capability checks.

| Function | Description | Arguments | Returns |
|---|---|---|---|
| `isTouch()` | Checks if the current device has a touch screen using a pointer media query. | None | `boolean` - `true` if the device supports touch, `false` otherwise. |

### URL Helpers (`$url`)
Provides robust URL utility helpers to handle path and endpoint parsing safely.

| Function | Description | Arguments | Returns |
|---|---|---|---|
| `normalizeUrl(baseUrl, ...paths)` | Normalizes a base URL and relative/absolute paths into a valid, safe URL string. Prevents protocol-relative `//` traps and double slashes. | `baseUrl`: `string` - The base/origin URL.<br>`...paths`: `string[]` - Suffix path segments to join. | `string` - The normalized URL string. |
