# desTajo — project instructions

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
| `jira:searchIssues` | `searchIssues(cfg, query)` | key lookup, else JQL `text ~` search | `{ ok, results }` or `{ ok: false, error }` |
| `jira:issueCopyData` | `getIssueCopyData(cfg, issueKey)` | `getCachedCopyRaw`, then a preview | `{ ok, issue, sections, comments, attachments }` or `{ ok: false, error }` |
| `copy:issue` | `copyIssue(cfg, payload)` | builds the Markdown, downloads assets, writes the clipboard | `{ ok, sections, comments, attachments, downloaded, failed, chars, folder }` or `{ ok: false, error }` |
| `shell:openExternal` | `openExternal(url)` | validates `^https?://`, then `shell.openExternal` | `boolean` |
| `notify` | `notify(payload)` | native `Notification` | `boolean` |
| `bugs:list` | `listBugs()` | reads every `bugs/<id>/nota.json`, newest first | `{ ok, items }` or `{ ok: false, error }` |
| `bugs:create` | `createBug(payload)` | writes the entry folder and its images | `{ ok, item, failed }` or `{ ok: false, error }` |
| `bugs:update` | `updateBug(id, changes)` | patches fields, or the state and Jira key | `{ ok, item }` or `{ ok: false, error }` |
| `bugs:delete` | `deleteBug(id)` | removes the whole folder | `{ ok }` or `{ ok: false, error }` |
| `bugs:image:add` | `addBugImage(id, image)` | validates type and size, writes `img-N.ext` | `{ ok, item }` or `{ ok: false, error }` |
| `bugs:image:read` | `readBugImage(id, filename)` | reads one image for its thumbnail | `{ ok, dataUrl }` or `{ ok: false, error }` |
| `bugs:image:delete` | `deleteBugImage(id, filename)` | unlinks the file and drops the entry | `{ ok, item }` or `{ ok: false, error }` |
| `bugs:markdown` / `bugs:copyMarkdown` | `getBugMarkdown(id)` / `copyBugMarkdown(id)` | renders the note as Markdown, optionally to the clipboard | `{ ok, markdown }` / `{ ok, chars }` |
| `bugs:copyImagePaths` | `copyBugImagePaths(id)` | clipboard with one image path per line | `{ ok, count }` or `{ ok: false, error }` |
| `bugs:openFolder` | `openBugFolder(id)` | validates the id, then `shell.openPath` | `{ ok }` or `{ ok: false, error }` |
| `bugs:openCapture` / `bugs:close` | `openBugCapture()` / `closeBugCapture()` | shows or hides the capture window | `{ ok }` |
| `bugs:context` | `getBugContext()` | last issue opened in the copy flow, plus a lone clipboard URL | `{ ok, issueKey, clipboardUrl }` |
| `bugs:draft:get` / `:save` / `:clear` | `getBugDraft()` / `saveBugDraft(draft)` / `clearBugDraft()` | `bugs/.draft.json` | `{ ok, draft }` / `{ ok, saved }` / `{ ok }` |
| `clipboard:writeText` | `writeClipboard(text)` | `clipboard.writeText` | `boolean` |

Handlers never throw to the renderer: they catch and return `{ ok: false, error }`. Keep that shape.

The capture window does not use `preload.js`: `renderer/capture/capture-preload.js` exposes only `createBug`, `getBugContext`, the three draft channels, `closeBugCapture` and `onShown` (the `capture:shown` push). Keep that surface minimal — the capture window has no reason to reach Jira, GitLab or the clipboard directly.

The copy flow can request a GitLab branch comparison through `copy:issue`; GitLab API traffic and clipboard writes stay in the main process. The renderer chooses a project visible to the token, then its source and target branches, each through a searchable combobox: the typed text is sent to GitLab as the `search` parameter (debounced 250 ms, one page of 100), so the suggestions are whatever GitLab returns and a filled page is reported as truncated. Typing an exact label commits it on Enter or blur — after asking GitLab if the list is closed; copy requires a project plus both branches, and changing the project discards the chosen branches. A field stays editable while it can still be searched: projects always, branches once a project is chosen, so a failed request never strands the user.

After a project is selected, the source-branch combobox searches with the Jira issue key and the target-branch combobox searches with `develop`. An exact returned match is selected automatically; otherwise the typed default stays editable with GitLab's suggestions.

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

## Bug inbox

The app is also a scratch pad for bugs found while developing. It never writes to Jira or GitLab for this feature: the user creates the task by hand and the app only records the key.

- `globalShortcut` opens `renderer/capture/index.html` in its own frameless, always-on-top window (`show: false`, positioned near the cursor with `screen.getDisplayNearestPoint`), so capture works with any application focused. `capture:shown` is pushed only when the window was hidden: pressing the hotkey again must not wipe what the user is typing.
- The default accelerator is `Control+Alt+J`, stored as `bugHotkey` in `config.json` and editable in Settings through a read-only field that captures the pressed combination. `normalizeAccelerator` (main and renderer, same rules) requires at least one modifier plus a key. If `register` returns `false`, `applyBugShortcut` re-registers the previous combination and `config:save` answers `{ ok: true, hotkeyError }`, so the user is never left without a shortcut. The tray is the fallback.
- `config:save` preserves the stored `bugHotkey` and `bugStartAtLogin` when a partial payload omits them (the GitLab credential buttons do). It rejects an invalid combination without rewriting `config.json`.
- With a tray present, closing the main window hides it (`window-all-closed` only quits when there is no tray), so the hotkey stays alive. `app.requestSingleInstanceLock` keeps a second instance from stealing it; `will-quit` unregisters every shortcut. `app.setLoginItemSettings` runs only when `app.isPackaged`.
- One folder per entry: `app.getPath('userData')/bugs/<id>/nota.json` plus `img-N.<ext>`, with `id` matching `^b-\d{14}-[0-9a-f]{4}$`. There is no central index: `bugs:list` reads the folders and skips anything unreadable. **The folder name is the authoritative id**: `normalizeBugNote` receives it as `trustedId` and ignores whatever `nota.json` claims, and `writeBugNote` refuses an id that does not match the pattern. Every id and filename is validated before a read, write or delete, so nothing reaches outside its own folder — a hand-edited `"id": "../escaped"` cannot redirect a write.
- Limits: 10 MB per image, 20 images per entry, 300 characters of title, 20 000 of details, 10 links. Image bytes cross IPC as an `ArrayBuffer`; `saveBugImage` converts it before checking length (`.length` is `undefined` on an `ArrayBuffer`).
- Links are classified by origin in `classifyLink`: `slack` (`*.slack.com/archives/…`), `jira` (`/browse/KEY-123`), `web`, or `otro`. A Jira link also suggests the related issue. Slack is treated as a source of context, never as an API to integrate.
- States: `new` → `created` (needs a key matching `^[A-Z][A-Z0-9_]*-\d+$`, also accepted as a `/browse/…` URL; stores `createdJiraAt`) → `archived`. Reopening a created entry clears its key.
- Drafts live in `bugs/.draft.json` and hold text, links and the issue only — never image bytes. `Esc` saves them, saving an entry clears them, and an empty draft deletes the file instead of creating an empty one.
- `bugs:context` feeds the capture window the last issue key touched by `getCachedCopyRaw` and, if the clipboard holds exactly one `http(s)` URL, that URL as a suggested link.

## Notification shape

`{ id, subject, issueKey, textBody, author, created, reason, read, webUrl }`, where `id` is `<issueId>:<commentId>` (or `<issueId>:mention` for the per-issue fallback). Sorted newest first.

## Traps

- `stripHtml` and `decodeHtml` in `renderer.js` parse remote HTML by assigning to `innerHTML` on a detached element. It does not execute scripts there, but it can load resources. If you extend text extraction, prefer `DOMParser` and never move that parsing into the live DOM.
- `read` from the main process comes from a 24-hour freshness window and is ignored by the renderer. The real read state is `destajo:readIds` in `localStorage`, keyed by notification `id`.
- `state.seenIds` drives the sound and the desktop notification for new mentions. It resets on config save so a fresh connection does not fire a burst of alerts.
- `backgroundThrottling: false` keeps the 5-minute poll and the 6-hour update check alive while the window is hidden. Removing it silently breaks the core promise of the app.
- The updater only runs when `app.isPackaged`. Skipping `checkForUpdates` in development is intentional.
- `configureUpdater` only sets a feed when `updateUrl` is configured; otherwise `electron-updater` falls back to `build.publish` in `package.json`.
- `scripts/serve-dist.js` is the reference update server. It must answer range requests because `electron-updater` fetches `.blockmap` diffs.
- `scripts/make-icon.js` must run through Electron (`npx electron scripts/make-icon.js`); it renders the SVG offscreen and needs a display.
- `build.files` is a whitelist. A new runtime file or folder that is not listed there is absent from the packaged app. `renderer/**/*` already covers the capture window; a new file at the repository root does not.
- `.filter-tab` now exists twice: the notification filter bar and the bug modal tabs. The wiring keeps `document.querySelectorAll('.filter-tab')` but ignores any tab without `data-filter`, otherwise clicking a bug tab sets `state.filter` to `undefined` and empties the notification list.
- The bug thumbnails in the main window are data URLs, so its CSP needs `img-src 'self' data:`. The capture window previews local files with `URL.createObjectURL`, so its CSP additionally needs `blob:`; without it Chromium refuses every image and the window looks like it never attached anything.
- `state.bugSettingsLoaded` gates the `bugHotkey`/`bugStartAtLogin` keys in `currentFormConfig()`: a payload that omits them makes `main.js` keep what is stored. `openModal()` always sets it to true (and paints the defaults when there is no stored config), otherwise the very first save of a fresh install would throw away the combination the user just captured.
- `scripts/check-bug-inbox.js` keeps process-wide state between its checks: `stub.__shortcuts` and the module-level `activeBugHotkey` in `main.js` survive `stub.__reset()`, so shortcut assertions must be relative to what the check itself saved.

## Packaging

- `appId` is `com.destajo.app` and `productName` is `desTajo`; `app.setAppUserModelId` must stay in sync on Windows or notifications lose their identity.
- Windows targets: `nsis` (assisted install, per-user) and `portable`.
- Output goes to `dist/`, which is git-ignored.

## Change checklist

- [ ] Renderer DOM built with `createElement` + `textContent`.
- [ ] New IPC channel wired in handler, preload, and call site. A capture-window-only channel goes in `renderer/capture/capture-preload.js`.
- [ ] New user-facing text is Spanish and neutral.
- [ ] `node --check` clean on touched files.
- [ ] Manual run: settings → test connection → refresh → filter → mark read → open a card.
- [ ] Manual run for the bug inbox: hotkey from another app → capture with an image → `Esc` → reopen → mark as created → copy Markdown.
- [ ] No token, absolute path, or build output in the diff.
