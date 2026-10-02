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
