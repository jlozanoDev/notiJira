# AGENTS.md

desTajo (formerly NotiJira) is a single-window Electron app that watches Jira and notifies the user when they are mentioned in a comment, plus a "copy task to Markdown" flow with optional GitLab/GitHub MR/PR diffs and a local bug inbox. Plain CommonJS, no bundler, no TypeScript.

This file is the portable contract. `.opencode/instructions.md` (loaded through `opencode.json`) holds the architecture map, the IPC contract, and the known traps; restart OpenCode after editing it.

## Commands

| Task | Command |
| --- | --- |
| Run the app | `npm start` |
| Syntax check | `node --check main.js` (also `preload.js`, `adf.js`, `renderer/renderer.js`, `renderer/capture/capture.js`) |
| ADF→Markdown checks | `npm run check:adf` (13 assertions) |
| Copy-flow checks (Jira + GitLab + GitHub) | `npm run check:copy` (51 assertions) |
| Renderer GitLab/GitHub checks | `npm run check:renderer` (27 assertions) |
| Live-search checks | `npm run check:search` (10 assertions) |
| Bug inbox checks (capture, storage, tray) | `npm run check:bugs` (45 assertions) |
| Rename migration checks (user data, read state) | `npm run check:rename` (7 assertions) |
| Package unpacked | `npm run pack` |
| Build installers | `npm run dist` |
| Serve `dist/` for the updater | `npm run serve:dist` (`PORT`, default 8080) |
| Regenerate icons | `npx electron scripts/make-icon.js` |

There is no `npm test`, no test framework, and no linter. The six `check:*` scripts are plain Node + `assert`: run them after touching `adf.js`, the copy flow, the GitLab part of the copy modal, the Jira search combobox, anything in the bug inbox (`main.js` handlers, `renderer/capture/`, the bug modal in the main window), or the user data migration. Everything else is verified by running the app.

## Layout

| Path | Role |
| --- | --- |
| `main.js` | Main process: window, IPC handlers, Jira and GitLab clients, clipboard copy, notifications, updater |
| `adf.js` | Atlassian Document Format → Markdown converter; `main.js` requires it at runtime |
| `preload.js` | `contextBridge` surface — the only bridge to the renderer |
| `renderer/` | UI: `index.html`, `renderer.js`, `styles.css` |
| `renderer/capture/` | Standalone capture window: `index.html`, `capture.js`, `capture.css`, `capture-preload.js` |
| `scripts/` | `serve-dist.js`, `make-icon.js`, and the `check-*.js` regression scripts |
| `scripts/test-support/` | `electron-stub.js` and `renderer-stub.js`, used only by the checks |
| `odd/tasks/` | Feature documents holding the specs the `check:*` assertions encode |
| `assets/` | `icon.ico`, `icon.png`, and the `destajo.svg` source |

## Hard rules

- Never enable `nodeIntegration` or disable `contextIsolation`. Renderer code reaches the main process only through `window.api` in `preload.js`.
- The visible name is `desTajo` (lowercase `des`, capital `T`) in every surface: top-level `productName`, `build.productName`, `nsis.shortcutName`, window and tray text, notifications, docs. `name` in `package.json` and `appId` stay lowercase (`destajo`, `com.destajo.app`) because they are identifiers, not the written name.
- A new renderer capability needs three edits together: an `ipcMain.handle` in `main.js`, a method in `preload.js`, and the call site in `renderer/renderer.js`. The capture window has its own surface (`renderer/capture/capture-preload.js`) and its own CSP: a channel used only there belongs there, not in `preload.js`.
- Anything shipped at runtime must be listed in `build.files` in `package.json` — `adf.js` is there for that reason. An unlisted runtime file is absent from the packaged app with no error.
- Treat all Jira and GitLab content as untrusted. Build DOM with `createElement` + `textContent`; never interpolate remote data into `innerHTML`.
- `shell.openExternal` stays restricted to `http:`/`https:` URLs validated in the main process.
- Jira, GitLab and GitHub tokens sit in plain text in `app.getPath('userData')/config.json`. Never log them, expose them outside password fields, or commit them. Send the GitLab token only to the configured GitLab URL. Send the GitHub token only to the configured GitHub URL.
- Keep the CSP in `renderer/index.html` working: no inline `<script>`, no remote script or style origins. `img-src 'self' data:` is required there and in the capture window; the capture window also needs `blob:` because its previews come from `URL.createObjectURL`.

## Checks run headless, not in Electron

`check-copy-flow.js` monkeypatches `Module._resolveFilename` so `require('electron')` resolves to `scripts/test-support/electron-stub.js`, then serves fake Jira/GitLab from a local `http` server. `check-renderer-gitlab.js` runs the real `renderer/renderer.js` against `renderer-stub.js` with a fake clock, advancing the 250 ms search debounce explicitly. `check-bug-inbox.js` uses both stubs: the main-process bug handlers and the tray/shortcut surface through `electron-stub.js` (which now also fakes `globalShortcut`, `Tray`, `screen` and `BrowserWindow`), and the real `renderer/capture/capture.js` through `renderer-stub.js` (`sourceFile` option). Reuse those stubs instead of inventing a harness, and register a `check:` script in `package.json` when you add one.

Because `main.js` requires `electron-updater` for real, running a checker from a scratch copy needs `NODE_PATH` pointed at the repo's `node_modules`. The renderer harness also needs 2–4 `setImmediate` ticks to settle a chain of awaited IPC calls; a single tick asserts against stale state. In the harness, clearing an element means `el.textContent = ''`, which drops its children — the same as the real DOM.

## Sensitive areas

Need manual verification against a real Jira instance:

- `buildAuthHeader` and `normalizeBaseUrl` — a wrong output breaks every request without an obvious error. URL normalization exists twice, in `main.js` and in `renderer.js`; change both together.
- The deliberate fallback chains (`/myself` v3→v2, `/search/jql` POST→`/search` GET, notifications feed→comment scan). Some deployments support only one side.
- GitLab requests reject redirects so `PRIVATE-TOKEN` cannot leak, and the branch comparison sends the target branch as `from` and the source as `to`.
- GitHub requests reject redirects so the `Authorization: Bearer` token cannot leak; the branch comparison uses `GET /repos/{owner}/{repo}/compare/{base}...{head}` and prefers `Accept: application/vnd.github.v3.diff` for the unified diff.
- The copy flow reuses one cached issue payload for 10 minutes: `jira:issueCopyData` fills it and `copy:issue` reads it, so the two must agree on the issue key.
- `configureUpdater` — a wrong feed URL stops updates silently.
- Read state is owned by the renderer (`localStorage`, key `destajo:readIds`), not by the main process.

Need manual verification against a real GitHub instance:

- `normalizeGitHubBaseUrl` — ensures HTTPS, defaults to `https://api.github.com`, rejects URLs with credentials. HTTP only allowed for local loopback test servers.
- GitHub API rate limiting: authenticated users get 5,000 req/hour; the 250 ms debounce and single-page limit are the only guards.

Need manual verification on a real desktop (the OS owns them, the checks can only fake them):

- `globalShortcut.register` and the tray: the hotkey only fires when another app has focus, and the tray menu is the only fallback when the combo is taken. `check:bugs` pins the registration/revert logic, not the OS behaviour.
- Bug images are only reachable through `BUG_ID_PATTERN`/`BUG_IMAGE_PATTERN`; every path is validated before read, write or delete, so a hand-edited `nota.json` cannot escape `bugs/<id>/`.
- `app.requestSingleInstanceLock` plus hide-on-close with a tray: two instances would fight over the global shortcut.

## Release

- Bump `version` in both `package.json` and `package-lock.json` before `npm run dist`.
- On Windows, `npm run dist` fails with `Cannot create symbolic link` unless Developer Mode is on or the terminal runs as Administrator. Enabling either and retrying is enough; no cleanup needed.

## Style

- Two-space indentation, single quotes, semicolons, CommonJS `require`.
- UI copy and user-facing strings are Spanish (`es-ES`) in a neutral register. Identifiers are English. New comments follow the language of the file's existing comments.
- No new dependency without a stated reason: `electron-updater` is the only runtime dependency.

## Definition of done

- `node --check` passes for every touched JavaScript file.
- The applicable `npm run check:*` scripts pass.
- `npm start` opens the window; settings accept base URL and token, "Probar conexion" succeeds, and the mention list renders.
- No secret, absolute local path, or `node_modules`/`dist` content in the diff.
