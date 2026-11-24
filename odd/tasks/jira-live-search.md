# Live Jira search suggestions (1.1.4)
- Objective: surface Jira issue suggestions while the user types in the search modal, matching by full issue key or description text, and ship NotiJira 1.1.4.
- Branch: `feature/jira-live-search` from `main` at `49bbac7`. Delivery strategy: `ask-on-risk`; forecast below approximately 400 authored changed lines.
- Test runner: no general suite; use `npm run check:search` (7), `npm run check:copy` (34), `npm run check:renderer` (27), `npm run check:adf` (13), `node --check` on touched JavaScript, and a manual run against a real Jira instance.

## Specs

### S1 — A select2-style combobox

> "quiero que el buscador en jira busque por numero de tarea o descripcion y busque en jira y de las opciones"

> "no me gusta como ha quedado, haz como si fuera un select2"

- The search modal is a combobox: the input is the field, the matches open in a list attached underneath it, and there is no `Buscar` button.
- The query is debounced at 250 ms and only fires with at least 2 characters; a shorter input keeps the list closed and explains the minimum.
- Keyboard: `ArrowDown`/`ArrowUp` move the active option, `Enter` opens the active option (or the only match), `Escape` closes the list without losing the typed text.
- A click on an option opens the copy modal for that issue key, unchanged.
- Check: `scripts/check-search-suggestions.js` drives the real renderer with a fake clock and asserts the debounce, the 2-character threshold, the arrow/Enter selection, the click, the Escape behaviour and the reopen.

### S2 — Issue key or description

> "busque por numero de tarea o descripcion y busque en jira y de las opciones"

- A full key (`PROJ-123`) resolves to that exact issue with a single request; the lookup tries `/rest/api/3/issue/{key}` and falls back to `/rest/api/2/issue/{key}` for Jira Server/Data Center.
- Anything else is a JQL text search, which covers summary, description, environment, and comments: `text ~ "<escaped>" ORDER BY updated DESC`, at most 20 results, 8 shown in the list.
- Assumption: "número de tarea" means the full issue key. JQL cannot wildcard issue keys, so a partial key (`PROJ-12`) or a bare number (`123`) falls back to the text search; the modal hint states that the project prefix is required.
- Check: `npm run check:copy` asserts the escaping and the text-search path.

### S3 — Stale responses and failures

- A slow response must never overwrite a newer result: every query carries a sequence number, and a response whose sequence is outdated is discarded.
- A Jira failure closes the list and shows the error in the message; it must not leave stale options on screen.
- Check: `scripts/check-search-suggestions.js` resolves two in-flight searches out of order and asserts the newest list survives.

### S4 — Version 1.1.4

> "Vamos a crear una nueva version 1.1.4 para añadir una nueva funcionalidad"

- Set `version` to `1.1.4` in `package.json` and in both root entries of `package-lock.json`.
- Building installers, publishing a GitHub release, and pushing remain separate human decisions.
- Check: `node -e "require('./package.json').version"` and the lockfile header.

### S5 — One combobox component

- The Jira search and the GitLab project/branch selectors share one implementation: `createCombo(input, list, options)`. The GitLab behaviour is unchanged, proven by its existing checks.
- Server-specific concerns are injected per combo (`fetchItems`, `isActive`, `session`, `setMessage`, `minChars`, `renderOption`, `onResults`, `commitOnBlur`, `keepTypedOnEscape`, `disableWhenInactive`, `closeOnError`).
- Check: `npm run check:renderer` (27) must keep passing after the extraction, and `npm run check:search` proves the Jira wiring.

## Tasks

| ID | Specs | Route | Status |
| --- | --- | --- | --- |
| T1 | S3 | inline | done — stale-response guard in the combo |
| T2 | S1 | inline | done — `renderer/renderer.js`, `renderer/index.html`, `renderer/styles.css` |
| T3 | S2 | inline | done — `main.js` |
| T4 | S4 | inline | done — `package.json`, `package-lock.json` |
| T5 | S5 | inline | done — `createGitlabCombo` extracted to `createCombo` |

## Log

### L1 — User request

> "Vamos a crear una nueva version 1.1.4 para añadir una nueva funcionalidad"

> "quiero que el buscador en jira busque por numero de tarea o descripcion y busque en jira y de las opciones"

### L2 — Decision

The user chose live suggestions over keeping the explicit `Buscar` button. The existing `jira:searchIssues` IPC channel, its preload method, and `rendererStub` keep the same shape; only the trigger changes.

### L3 — Behaviour revision on an existing spec

`scripts/check-copy-flow.js` asserted that a non-existent key always surfaces an error. That message would flash "the issue does not exist" on every keystroke that happens to form a key (`CLIN-1` while typing `CLIN-1234`), so it now appears only when the text search also returns nothing. The assertion was split in two: matches without notice, and no matches with the notice.

### L4 — Correction: the list-plus-button layout is rejected

> "no me gusta como ha quedado, haz como si fuera un select2"

The first delivery kept a `Buscar` button and a plain results list. It was replaced by the shared combobox the copy modal already uses for GitLab: attached dropdown, keyboard navigation, no submit button. `createGitlabCombo` was extracted into `createCombo` so both flows share one implementation, and `scripts/check-renderer-gitlab.js` now opens the copy modal by typing into the combobox and choosing the suggestion.
