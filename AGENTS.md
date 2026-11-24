# AGENTS.md

NotiJira is a single-window Electron app that watches Jira and notifies the user when they are mentioned in a comment, plus a "copy task to Markdown" flow with optional GitLab branch diffs. Plain CommonJS, no bundler, no TypeScript.

This file is the portable contract. `.opencode/instructions.md` (loaded through `opencode.json`) holds the architecture map, the IPC contract, and the known traps; restart OpenCode after editing it.

## Commands

| Task | Command |
| --- | --- |
| Run the app | `npm start` |
| Syntax check | `node --check main.js` (also `preload.js`, `adf.js`, `renderer/renderer.js`) |
| ADF→Markdown checks | `npm run check:adf` (13 assertions) |
| Copy-flow checks (Jira + GitLab) | `npm run check:copy` (34 assertions) |
| Renderer GitLab checks | `npm run check:renderer` (27 assertions) |
| Live-search checks | `npm run check:search` (7 assertions) |
| Package unpacked | `npm run pack` |
| Build installers | `npm run dist` |
| Serve `dist/` for the updater | `npm run serve:dist` (`PORT`, default 8080) |
| Regenerate icons | `npx electron scripts/make-icon.js` |

There is no `npm test`, no test framework, and no linter. The three `check:*` scripts are plain Node + `assert`: run them after touching `adf.js`, the copy flow, or the GitLab part of the copy modal. Everything else is verified by running the app.

## Layout

| Path | Role |
| --- | --- |
| `main.js` | Main process: window, IPC handlers, Jira and GitLab clients, clipboard copy, notifications, updater |
| `adf.js` | Atlassian Document Format → Markdown converter; `main.js` requires it at runtime |
| `preload.js` | `contextBridge` surface — the only bridge to the renderer |
| `renderer/` | UI: `index.html`, `renderer.js`, `styles.css` |
| `scripts/` | `serve-dist.js`, `make-icon.js`, and the `check-*.js` regression scripts |
| `scripts/test-support/` | `electron-stub.js` and `renderer-stub.js`, used only by the checks |
| `odd/tasks/` | Feature documents holding the specs the `check:*` assertions encode |
| `assets/` | `icon.ico`, `icon.png`, and the `jira.svg` source |

## Hard rules

- Never enable `nodeIntegration` or disable `contextIsolation`. Renderer code reaches the main process only through `window.api` in `preload.js`.
- A new renderer capability needs three edits together: an `ipcMain.handle` in `main.js`, a method in `preload.js`, and the call site in `renderer/renderer.js`.
- Anything shipped at runtime must be listed in `build.files` in `package.json` — `adf.js` is there for that reason. An unlisted runtime file is absent from the packaged app with no error.
- Treat all Jira and GitLab content as untrusted. Build DOM with `createElement` + `textContent`; never interpolate remote data into `innerHTML`.
- `shell.openExternal` stays restricted to `http:`/`https:` URLs validated in the main process.
- Jira and GitLab tokens sit in plain text in `app.getPath('userData')/config.json`. Never log them, expose them outside password fields, or commit them. Send the GitLab token only to the configured GitLab URL.
- Keep the CSP in `renderer/index.html` working: no inline `<script>`, no remote script or style origins.

## Checks run headless, not in Electron

`check-copy-flow.js` monkeypatches `Module._resolveFilename` so `require('electron')` resolves to `scripts/test-support/electron-stub.js`, then serves fake Jira/GitLab from a local `http` server. `check-renderer-gitlab.js` runs the real `renderer/renderer.js` against `renderer-stub.js` with a fake clock, advancing the 250 ms search debounce explicitly. Reuse those stubs instead of inventing a harness, and register a `check:` script in `package.json` when you add one.

Because `main.js` requires `electron-updater` for real, running a checker from a scratch copy needs `NODE_PATH` pointed at the repo's `node_modules`. The renderer harness also needs 2–4 `setImmediate` ticks to settle a chain of awaited IPC calls; a single tick asserts against stale state.

## Sensitive areas

Need manual verification against a real Jira instance:

- `buildAuthHeader` and `normalizeBaseUrl` — a wrong output breaks every request without an obvious error. URL normalization exists twice, in `main.js` and in `renderer.js`; change both together.
- The deliberate fallback chains (`/myself` v3→v2, `/search/jql` POST→`/search` GET, notifications feed→comment scan). Some deployments support only one side.
- GitLab requests reject redirects so `PRIVATE-TOKEN` cannot leak, and the branch comparison sends the target branch as `from` and the source as `to`.
- The copy flow reuses one cached issue payload for 10 minutes: `jira:issueCopyData` fills it and `copy:issue` reads it, so the two must agree on the issue key.
- `configureUpdater` — a wrong feed URL stops updates silently.
- Read state is owned by the renderer (`localStorage`, key `notijira:readIds`), not by the main process.

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
