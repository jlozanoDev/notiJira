# NotiJira — project instructions

Deep reference for work in this repository. `AGENTS.md` holds the short contract; this file holds the map and the traps.

## What the app does

A single-window Electron app that polls Jira and surfaces comments where the current user is mentioned. Everything runs locally: no backend, no telemetry, no account system.

## Runtime shape

```
renderer/index.html + renderer.js + styles.css
        |
        |  window.api  (preload.js, contextBridge)
        |  ipcRenderer.invoke
        v
main.js — ipcMain.handle, Jira and GitLab clients, notifications, updater
        |
        +-- config.json in app.getPath('userData')
        +-- Jira and GitLab REST over fetch
```

The renderer never touches `fs`, `fetch`, or Node APIs. `main.js` owns all I/O.

## IPC contract

| Channel | Preload method | Main handler | Returns |
| --- | --- | --- | --- |
| `config:get` | `getConfig()` | reads `config.json` | config object or `null` |
| `config:save` | `saveConfig(cfg)` | normalizes, writes `config.json`, reconfigures the updater | `{ ok: true }` or `{ ok: false, error }` |
| `jira:test` | `testConnection(cfg)` | `getMyself` | `{ ok, displayName, accountId }` or `{ ok: false, error }` |
| `jira:notifications` | `getNotifications(cfg)` | `fetchNotifications` | `{ ok, notifications }` or `{ ok: false, error }` |
| `gitlab:projects` | `getGitlabProjects(cfg, search)` | one `GET /projects` page filtered by `search` | `{ ok, projects, truncated }` or `{ ok: false, error }` |
| `gitlab:branches` | `getGitlabBranches(cfg, projectId, search)` | one `GET /projects/:id/repository/branches` page filtered by `search` | `{ ok, branches, truncated }` or `{ ok: false, error }` |
| `shell:openExternal` | `openExternal(url)` | validates `^https?://`, then `shell.openExternal` | `boolean` |
| `notify` | `notify(payload)` | native `Notification` | `boolean` |

Handlers never throw to the renderer: they catch and return `{ ok: false, error }`. Keep that shape.

The copy flow can request a GitLab branch comparison through `copy:issue`; GitLab API traffic and clipboard writes stay in the main process. The renderer chooses a project visible to the token, then its source and target branches, each through a searchable combobox: the typed text is sent to GitLab as the `search` parameter (debounced 250 ms, one page of 100), so the suggestions are whatever GitLab returns and a filled page is reported as truncated. Typing an exact label commits it on Enter or blur — after asking GitLab if the list is closed; copy requires a project plus both branches, and changing the project discards the chosen branches. A field stays editable while it can still be searched: projects always, branches once a project is chosen, so a failed request never strands the user.

`config:save` returns `{ ok: true }` or `{ ok: false, error }`; it never rejects across IPC. A rejected save leaves `config.json` untouched, so the renderer must check `ok` and keep the settings modal open. After a successful save the renderer re-reads `getConfig()` because the main process normalizes the URLs. If the settings modal was opened from the copy flow (`state.returnToCopyModal`), `restoreCopyModalAfterGitlabSetup()` reopens the copy modal with the GitLab panel visible — do not replace it with a plain `closeModal()`, that leaves the selectors hidden.

## Jira access

Base URL normalization (trailing slashes stripped, `https://` prefixed when missing) exists twice, in `main.js` and in `renderer.js`. Change both together or the UI and the client disagree.

Auth: `Basic base64(email:token)` when an email is configured, otherwise `Bearer token`. That covers Jira Cloud API tokens (email + token) and Server/Data Center personal access tokens (token only).

Fallback chains, all intentional:

| Purpose | First try | Fallback |
| --- | --- | --- |
| Current user | `GET /rest/api/3/myself` | `GET /rest/api/2/myself` |
| Issue search | `POST /rest/api/3/search/jql` | `GET /rest/api/2/search` on 404/410 |
| Notifications | `GET /rest/api/3/notifications` | comment mention scan |

Rate limiting: 429 responses retry using `Retry-After` (capped at 30 s), two retries by default.

Mention scan: JQL `comment ~ currentUser() AND updated >= -90d`, retried with `comment ~ "<accountId>"` on 400. Limits: 100 issues, 4 concurrent requests, up to 10 comment pages of 100 per issue.

## GitLab access

- Configure the GitLab instance root URL and an access token with `api` permission. Require HTTPS; HTTP is allowed only for loopback test servers.
- `main.js` sends the token in the `PRIVATE-TOKEN` header to that configured host and uses `/projects`, `/projects/:id/repository/branches`, and `/projects/:id/repository/compare`. Requests reject redirects to avoid forwarding the token.
- Project and branch lists are searched **server-side** with the `search` parameter, one page of 100 (`per_page=100&page=1`) per query. `truncated: true` means GitLab filled the page, so the UI asks for a more specific term. The renderer debounces queries at 250 ms and keeps one sequence number per field, so a slow response never overwrites a newer list of the same field.
- The comparison uses the target branch as `from` and source branch as `to`; its diff is appended after the Jira Markdown.
- GitLab credentials share `config.json` in `app.getPath('userData')` and are stored in plain text like Jira credentials. Never log either token or include it in copied Markdown.

## Notification shape

`{ id, subject, issueKey, textBody, author, created, reason, read, webUrl }`, where `id` is `<issueId>:<commentId>` (or `<issueId>:mention` for the per-issue fallback). Sorted newest first.

## Traps

- `stripHtml` and `decodeHtml` in `renderer.js` parse remote HTML by assigning to `innerHTML` on a detached element. It does not execute scripts there, but it can load resources. If you extend text extraction, prefer `DOMParser` and never move that parsing into the live DOM.
- `read` from the main process comes from a 24-hour freshness window and is ignored by the renderer. The real read state is `notijira:readIds` in `localStorage`, keyed by notification `id`.
- `state.seenIds` drives the sound and the desktop notification for new mentions. It resets on config save so a fresh connection does not fire a burst of alerts.
- `backgroundThrottling: false` keeps the 5-minute poll and the 6-hour update check alive while the window is hidden. Removing it silently breaks the core promise of the app.
- The updater only runs when `app.isPackaged`. Skipping `checkForUpdates` in development is intentional.
- `configureUpdater` only sets a feed when `updateUrl` is configured; otherwise `electron-updater` falls back to `build.publish` in `package.json`.
- `scripts/serve-dist.js` is the reference update server. It must answer range requests because `electron-updater` fetches `.blockmap` diffs.
- `scripts/make-icon.js` must run through Electron (`npx electron scripts/make-icon.js`); it renders the SVG offscreen and needs a display.
- `build.files` is a whitelist. A new runtime file or folder that is not listed there is absent from the packaged app.

## Packaging

- `appId` is `com.notijira.app` and `productName` is `NotiJira`; `app.setAppUserModelId` must stay in sync on Windows or notifications lose their identity.
- Windows targets: `nsis` (assisted install, per-user) and `portable`.
- Output goes to `dist/`, which is git-ignored.

## Change checklist

- [ ] Renderer DOM built with `createElement` + `textContent`.
- [ ] New IPC channel wired in handler, preload, and call site.
- [ ] New user-facing text is Spanish and neutral.
- [ ] `node --check` clean on touched files.
- [ ] Manual run: settings → test connection → refresh → filter → mark read → open a card.
- [ ] No token, absolute path, or build output in the diff.
