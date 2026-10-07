# Coralite Upstream Feedback

Status: Active — tracks client-team friction with Coralite and its upstream disposition.

**Coralite reference:** https://coralite.dev/llms.txt
**Coralite issue tracker:** https://codeberg.org/tjdavid/coralite/issues

## Entries

### CF-001 — `coralite` crashes when configured `components` directory is absent

- **Task:** C-INFRA-2
- **Tier:** T1 — Bug
- **Status:** filed-upstream; client-mitigated-by-input
- **Client-side action taken:** Provided the missing input directory required by Coralite. Bug remains filed upstream. See task C-INFRA-2b.
- **Issue URL:** https://codeberg.org/tjdavid/coralite/issues
- **Component:** `coralite` v1.0.0-rc.5
- **Description:** `createCoralite()` throws `CoraliteError: Root directory was not found: src/components` when `components: 'src/components'` is configured in `coralite.config.js` but `src/components` does not exist on disk. Framework documentation specifies that an absent components directory should be tolerated with a warning.
- **Impact:** Blocks build execution when starting projects or building initial skeletons prior to component creation.

### CF-002 — `coralite-scripts` crashes when configured `public` directory is absent

- **Task:** C-INFRA-2
- **Tier:** T1 — Bug
- **Status:** filed-upstream; client-mitigated-by-input
- **Client-side action taken:** Provided the missing input directory required by Coralite. Bug remains filed upstream. See task C-INFRA-2b.
- **Issue URL:** https://codeberg.org/tjdavid/coralite/issues
- **Component:** `coralite-scripts` v1.0.0-rc.5
- **Description:** `buildCommand()` in `coralite-scripts` attempts `copyDirectory(publicDir, config.output)` without checking `existsSync(publicDir)`. When `public: 'public'` is defined in `coralite.config.js` and `public/` does not exist, `copyDirectory` throws `Error: ENOENT: no such file or directory, lstat 'public'`.
- **Impact:** Blocks build execution when `public` is declared in configuration before static public assets are created.

### CF-003 — `coralite-scripts test` HTTP dev server omits client component JS script bundles

- **Task:** C-AUTH-1
- **Tier:** T2 — Missing feature, has clean alternative
- **Status:** filed-upstream; client-mitigated-by-architecture
- **Client-side action taken:** Verified component shell HTML structure, SSR output, event contracts, and build pipeline. Documented testing dev server limitation in client verification log.
- **Issue URL:** https://codeberg.org/tjdavid/coralite/issues
- **Component:** `coralite-scripts` v1.0.0-rc.5
- **Description:** During `coralite-scripts test`, the testing HTTP server SSR-renders custom components into static HTML with `active` attribute markup but does not inject client script tag bundle references (`manifest.js` / component JS modules) into HTML responses served at `/index.html`. As a result, client-side event listeners defined in component `<script>` blocks do not hydrate during Playwright test execution against the dev server.
- **Impact:** Playwright tests against `coralite-scripts test` verify static SSR component structure and markup, while interactive client behavior is wired via hydrated client scripts produced by `coralite-scripts build`.

### CF-004 — Dev/Prod CSS `@import` resolution divergence in default build pipeline

- **Task:** C-INFRA-5b
- **Tier:** T4 — Enhancement / optimization
- **Status:** filed-upstream; client-mitigated-by-configuration
- **Client-side action taken:** Configured `styles.processors.postcss.plugins: [postcssImport()]` in `coralite.config.js` and added build-output unit test.
- **Issue URL:** https://codeberg.org/tjdavid/coralite/issues
- **Component:** `coralite-scripts` v1.0.0-rc.5
- **Description:** `coralite-scripts dev`/`test` server resolves native CSS `@import` statements when serving styles, whereas `coralite-scripts build` preserves `@import` statements verbatim in `dist/assets/css/main.css` unless `postcss-import` is explicitly configured. This dev/prod divergence allows unbundled `@import` statements to silently ship to production where relative CSS import paths fail to load.
- **Impact:** Production build output contained unbundled `@import` statements resulting in unstyled pages until `postcss-import` was explicitly added as a PostCSS plugin.

### CF-005 — LLM Reference §6.4 vs Runtime Discrepancy: Getters Context Excludes Plugin Context

- **Task:** C-V-E
- **Tier:** T4 — Documentation bug / enhancement
- **Status:** filed-upstream; client-mitigated-by-architecture
- **Client-side action taken:** Empirical verification confirmed that getters receive strictly `{ state, root, refs, slots, signal }` without plugin context. Updated component migration patterns to access plugin context in `client()` or `server()`.
- **Issue URL:** https://codeberg.org/tjdavid/coralite/issues
- **Component:** `coralite` v1.0.0-rc.5
- **Description:** Client Spec §26.4 and Design Decision #28 asserted that `t()` is available in getters, whereas Coralite LLM Reference §6.4 defined getter context as `{ state, root, refs, slots, signal }`. Inspection of `coralite-element.js` (lines 1858–1865) and `index.js` (line 11630) confirmed that `getter(context)` receives strictly `{ state, root, refs, slots, signal }` and does NOT receive plugin context.
- **Impact:** Attempting to call `t()` or access plugin context inside `getters` results in `undefined` errors.

### CF-006 — In-place SSR AST token mutation prevents multi-render SSR token substitution

- **Task:** C-INFRA-6b
- **Tier:** T1 — Bug / T2 Framework Constraint
- **Status:** filed-upstream; client-mitigated-by-architecture
- **Client-side action taken:** Migrated all translation key naming conventions to valid identifier underscore notation (`auth_login_title`), updated factory/plugin helpers, and documented client-rendered SPA hydration pattern.
- **Issue URL:** https://codeberg.org/tjdavid/coralite/issues
- **Component:** `coralite` v1.0.0-rc.5
- **Description:** In `index.js` (`replaceToken`), Coralite performs SSR `<c-token>` substitution by directly mutating cached component AST text nodes (`node.data = node.data.replace(content, value)`). On subsequent SSR render passes, the cached AST nodes no longer contain the `{{ token }}` string pattern, leaving `<c-token></c-token>` placeholders empty in HTML responses.
- **Impact:** SSR renders empty `<c-token>` tags after the first render pass across all custom elements using server state bindings.

### CF-007 — LLM reference omits `client.config` from the plugin example

- **Task:** C-INFRA-24
- **Tier:** T4 — Documentation bug / enhancement
- **Status:** filed-upstream; client-mitigated-by-architecture
- **Client-side action taken:** Authored `docs/plugins/authoring.md` documenting `client.config` delivery pattern and updated `storage-plugin.js` to set `client.config`.
- **Issue URL:** https://codeberg.org/tjdavid/coralite/issues
- **Component:** `coralite` v1.0.0-rc.5
- **Description:** The Coralite LLM reference's `definePlugin` example (§7.1) shows `client.context` but omits `client.config`. The published Coralite documentation at coralite.dev documents `client.config` as the sanctioned mechanism for passing build-time data to the client. The omission in the LLM reference caused the client team to conclude that no such mechanism existed, leading to a misdiagnosis (C-V-H) and an unnecessary workaround proposal.
- **Impact:** A verification task (C-V-H) concluded that plugin factory options cannot be delivered to the client at all. The correct mechanism (`client.config` → `pluginContext.config`) was discovered later. The misdiagnosis cost one verification cycle and one wrongly-scoped fix task.
