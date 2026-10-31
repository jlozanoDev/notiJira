# AGENTS.md

NotiJira is a small Electron desktop app that watches Jira and notifies the user when they are mentioned in a comment. Plain CommonJS, no bundler, no TypeScript, no test suite.

This file is the portable contract for any coding agent. `.opencode/instructions.md` holds the full architecture map, the IPC contract, and the known traps.

## Commands

| Task | Command |
| --- | --- |
| Run the app | `npm start` |
| Syntax check | `node --check main.js` (same for `preload.js` and `renderer/renderer.js`) |
| Package unpacked | `npm run pack` |
| Build installers | `npm run dist` |
| Serve `dist/` for the updater | `npm run serve:dist` (PORT defaults to 8080) |
| Regenerate icons | `npx electron scripts/make-icon.js` |

There is no test runner and no linter. Verify behavior by running the app; verify logic by exercising the pure helpers with `node -e`.

## Layout

| Path | Role |
| --- | --- |
| `main.js` | Electron main process: window, IPC handlers, Jira client, native notifications, updater |
| `preload.js` | `contextBridge` surface — the only bridge to the renderer |
| `renderer/` | UI: `index.html`, `renderer.js`, `styles.css` |
| `assets/` | `icon.ico`, `icon.png`, and the `jira.svg` source |
| `scripts/` | `serve-dist.js` update server, `make-icon.js` icon generator |

## Hard rules

- Never enable `nodeIntegration` or disable `contextIsolation`. Renderer code reaches the main process only through `window.api` defined in `preload.js`.
- A new renderer capability needs three edits together: an `ipcMain.handle` in `main.js`, a method in `preload.js`, and the call site in `renderer/renderer.js`.
- Treat all Jira content as untrusted. Build DOM with `createElement` + `textContent`; never interpolate remote data into `innerHTML`.
- `shell.openExternal` stays restricted to `http:`/`https:` URLs, validated in the main process.
- The API token is stored in plain text in `app.getPath('userData')/config.json`. Never log it, expose it outside the password field, or commit it.
- Keep the CSP in `renderer/index.html` working: no inline `<script>`, no remote script or style origins.
- Anything shipped at runtime must be listed in `build.files` in `package.json`, or it will not be packaged.

## Style

- Two-space indentation, single quotes, semicolons, CommonJS `require`.
- UI copy and user-facing strings are Spanish (`es-ES`) in a neutral register. Identifiers are English. New comments follow the language of the file's existing comments.
- No new dependency without a stated reason: the app intentionally ships with only `electron-updater` at runtime.

## Sensitive areas

Changes here need manual verification against a real Jira instance:

- `buildAuthHeader` and `normalizeBaseUrl` — a wrong output breaks every request without an obvious error.
- The deliberate API fallback chains (`/myself` v3→v2, `/search/jql` POST→`/search` GET, notifications feed→comment scan). Some deployments only support one side.
- `configureUpdater` — a wrong feed URL stops updates silently.
- Read state: owned by the renderer (`localStorage`), not by the main process.

## Definition of done

- `node --check` passes for every touched JavaScript file.
- `npm start` opens the window, the settings modal accepts base URL and token, "Probar conexion" succeeds, and the mention list renders.
- No secret, absolute local path, or `node_modules`/`dist` content in the diff.
