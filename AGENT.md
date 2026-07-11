# Coding and Style Guidelines for Atoll Chat

This document details the code rules, syntax preferences, formatting standards, and custom linting rules that **must** be adhered to when writing or modifying JavaScript and HTML code in this repository.

---

## 1. File Scope & Exclusions

These rules apply to all **JavaScript (`.js`)** and **HTML (`.html`)** files within the project.

### Ignored Directories
The directories defined in the `.gitignore` are excluded from these style rules and linting

---

## 2. Comments Rules

Comments must follow strict styling rules to keep the codebase clean and avoid arbitrary markers or numbering structures.

### No Inline Comments (`no-inline-comments`)
Inline comments are forbidden. Comments must be placed on their own line, above the code they describe.

* **Incorrect:**
  ```javascript
  const port = 3000 // Server port
  ```
* **Correct:**
  ```javascript
  // Server port
  const port = 3000
  ```

### No Separator Comments (`no-restricted-comment-patterns`)
Do not use comment separators consisting of hyphens/dashes (`---`).
* **Incorrect:**
  ```javascript
  // -----------------------------
  // Setup Server Routing
  // -----------------------------
  ```
* **Correct:**
  ```javascript
  // Setup Server Routing
  ```

### No Numbered Step Comments (`no-restricted-comment-patterns`)
Do not prefix your comments with step numbers (e.g., `1. `, `2. `). Use descriptive text instead.
* **Incorrect:**
  ```javascript
  // 1. Initialize the database connection.
  await initDb()
  // 2. Start the express server.
  app.listen(port)
  ```
* **Correct:**
  ```javascript
  // Initialize the database connection.
  await initDb()

  // Start the express server.
  app.listen(port)
  ```

---

## 3. Syntax Restrictions

To maintain code readability and prevent overly complex syntax patterns:

### Avoid Deep Optional Chaining (`no-restricted-syntax`)
You must not chain more than two optional elements. Deep optional chains (`a?.b?.c?.d`) are prohibited. Validate data existence earlier using standard `if` statements or guard clauses instead.
* **Incorrect:**
  ```javascript
  const streetName = user?.profile?.address?.street?.name
  ```
* **Correct:**
  ```javascript
  if (!user || !user.profile || !user.profile.address) {
    return
  }
  const streetName = user.profile.address.street?.name
  ```

### No Nested Ternaries (`no-nested-ternary`)
Nested ternary operators are forbidden. Use standard `if-else` blocks or early returns to clarify conditions.
* **Incorrect:**
  ```javascript
  const status = isRegistered ? (isAdmin ? 'Admin' : 'User') : 'Guest'
  ```
* **Correct:**
  ```javascript
  let status = 'Guest'
  if (isRegistered) {
    status = isAdmin ? 'Admin' : 'User'
  }
  ```

### Strict Control Flow Bracing (`curly`)
Always use curly braces `{}` for all control statements (`if`, `else`, `for`, `while`, etc.), even for single-line blocks. Single-line statements without braces are errors.
* **Incorrect:**
  ```javascript
  if (isReady) start()
  ```
* **Correct:**
  ```javascript
  if (isReady) {
    start()
  }
  ```

### Unused Variables Prefix (`no-unused-vars`)
All unused variables, function parameters, and caught errors must be prefixed with an underscore (`_`).
* **Incorrect:**
  ```javascript
  try {
    performAction()
  } catch (error) {
    console.log('Action failed')
  }
  ```
* **Correct:**
  ```javascript
  try {
    performAction()
  } catch (_error) {
    console.log('Action failed')
  }
  ```

---

## 4. JSDoc Style Guide

All public constructs (exported functions, class declarations, method definitions, arrow functions, and function expressions) require JSDoc documentation.

### General JSDoc Rules
* Every `@param` must include both a `{type}` and a `description`.
* The parameter names listed in JSDoc must match the actual function arguments.
* Destructured root elements are exempt from checking.

### Custom JSDoc Tags
You may use the following custom tags in JSDoc comments:
- `@note` - Add specific usage notes.
- `@overload` - Describe overloaded signatures.
- `@query-parameters` - Define parameters expected in API query strings.
- `@returns-error` - Detail potential errors thrown or returned.
- `@returns-response` - Detail HTTP responses.
- `@returns-success` - Detail successful return paths.
- `@supported-operators` - Describe query/conditional operators supported by the logic.
- `@supported-values` - List valid constants or literal values accepted.

### Allowed Types
When documenting parameters or return types, use these predefined custom types where appropriate:
* Native & Utility: `AbortController`, `AbortSignal`, `AsyncGenerator`, `Buffer`, `DOMHighResTimeStamp`, `Element`, `File`, `FormData`, `HTMLCollection`, `HTMLElement`, `HTMLFormControlsCollection`, `Node`, `NodeJS`
* Testing: `TestContext`, `MutationObserver`

### Example JSDoc
```javascript
/**
 * Processes the incoming request payloads.
 *
 * @note This method runs asynchronously and requires buffer access.
 * @param {Buffer} payload The raw buffer payload to process.
 * @param {HTMLElement} target The target DOM element output.
 * @returns {Promise<void>} Resolves when execution completes.
 */
export async function processPayload (payload, target) {
  // Implementation...
}
```

---

## 5. Global Event Pattern

All global communications emitted via the global event bus (`$bus`) must follow the unified naming and routing conventions defined in [events.md](file:///home/thomas/Projects/atoll-chat/docs/events.md).

### Naming Convention
* **Format**: `<relation>:<event_name>` (e.g., `ui:show_toast`, `db:new_local_data`).
* **Casing**: All lowercase.
* **Separators**:
  - `:` separates the relational source from the specific event type.
  - `_` (underscore) separates words within the relation or event name (do not use hyphens).
* **Default Fallback**: Events emitted without a relation (e.g., missing a colon) will automatically default to the `app:` relation.

### Main Event Categories
- **UI (`ui:`)**: Manages user interface states, toasts, modals, and window actions (e.g., `ui:show_toast`, `ui:open_create_room`).
- **Database & Sync (`db:`, `sync:`)**: Handles local IndexedDB operations and replication catchup (e.g., `db:new_local_data`, `sync:complete`).
- **Room & Message (`room:`, `message:`)**: Handles room states, active room switches, and messaging outcomes (e.g., `room:read_state_changed`, `message:sent`).
- **Media Player (`media:`)**: Controls the headless audio/video engine (e.g., `media:play`, `media:pause`).
- **Calls (`call:`)**: Real-time WebRTC signals (e.g., `call:incoming`, `call:ended`).
- **Picture-in-Picture (`pip:`)**: Handles floating overlay expansions and positional resets (e.g., `pip:expand`).
- **Authentication (`auth:`)**: Session login/logout and vault-unlock states (e.g., `auth:logout`, `auth:unlocked`).
- **Worker (`worker:`)**: Background cryptographic module lifecycle signals (e.g., `worker:ready`).

---

## 6. Code Formatting & Stylistic Preferences

Formatting must strictly match the following stylistic guidelines (matching `@stylistic/js` rules):

### Semicolons (`semi`)
* Semicolons are **strictly forbidden** (`never`), except where required as statement delimiters (e.g. immediately preceding a destructuring line starting with `[`).
  ```javascript
  const message = 'Hello'
  console.log(message)
  ```

### Quotes (`quotes`)
* Use **single quotes** (`'`) for string literals.
* Avoid escaping single quotes by using template literals or double quotes if escaping is otherwise necessary.
* Template literals are always allowed.

### Indentation (`indent`)
* Use **2 spaces** for indentation.
* Indent switches, variable declarators, member expressions, function bodies/params, arrays, object expressions, and imports consistently.

### Braces Style (`brace-style` and `curly-newline`)
* Use the **One True Brace Style (1TBS)**. Opening curly braces must be on the same line as their control statements, and the closing brace must be on a new line (single-line blocks are not allowed).
* Enforce newlines around curly braces (`curly-newline: always`) for functions and major blocks.

### Spacing around Objects and Arrays
* **Objects (`object-curly-spacing`)**: Always include spaces inside curly braces.
  ```javascript
  const obj = { name: 'Atoll' }
  ```
* **Arrays (`array-bracket-spacing`)**: Do not use spaces inside array brackets.
  ```javascript
  const arr = [1, 2, 3]
  ```
* **Keys (`key-spacing`)**: Strict key spacing is enforced (no space before colon, exactly one space after colon).
  ```javascript
  const mapping = {
    key: 'value'
  }
  ```

### Function Declarations & Calls
* **Function definition (`space-before-function-paren`)**: Always place a space before the parenthesis in a function signature.
  ```javascript
  function calculate (x) {
    return x * 2
  }
  const compute = async (val) => { ... }
  ```
* **Function call (`function-call-spacing`)**: Do not put spaces between the function name and parenthesis when invoking a function.
  ```javascript
  calculate(5) // Correct
  ```

### Arrow Functions
* **Arrow Linebreak (`implicit-arrow-linebreak`)**: Implicit returns for arrow functions must be placed on the same line as the arrow.
  ```javascript
  const double = (x) => x * 2
  ```

### Lists and Trailing Commas (`comma-dangle` & `comma-style`)
* Trailing commas are **forbidden** (`never`).
* Commas must always be at the end of the line (`comma-style: last`).
* Commas must be followed by a space, with no space before them (`comma-spacing`).

### Operators (`no-mixed-operators`)
* Explicit parentheses must be used when mixing operators of different precedence groups (arithmetic, logical, comparison, bitwise, etc.). Do not rely on default operator precedence.
* **Incorrect:**
  ```javascript
  const val = a + b * c
  ```
* **Correct:**
  ```javascript
  const val = a + (b * c)
  ```

### Whitespace Cleanliness
* No trailing spaces are allowed at the end of lines (`no-trailing-spaces`).
* Multiple consecutive spaces are forbidden except for indentation (`no-multi-spaces`).
* All files must end with a single empty newline (`eol-last`).

---

## 7. Verification & Linting Scripts

Before completing any task or code change, both of the following validation scripts **must** run and pass with zero errors:

1. **`pnpm run lint:types`** - Runs TypeScript compiler checks over JavaScript files (via `checkJs` rules) to verify type correctness.
2. **`pnpm run lint:format`** - Verifies code formatting and strict ESLint compliance using project style rules.

