# Destajo rename

- Objective: rename the application from NotiJira to desTajo across runtime, packaging, docs, icon and local data, without losing user data.
- Branch: `feature/destajo-rename`. Delivery: single PR. Test runner: `node scripts/check-*.js` (no framework).

## Specs

- **S1** — The visible application name is `desTajo`: window title, header title and logo badge, tray tooltip, tray menu entry, default notification title, updater messages.
- **S2** — `package.json` holds `name: "destajo"`, top-level `productName: "desTajo"`, `build.appId: "com.destajo.app"`, `build.productName: "desTajo"` and `build.nsis.shortcutName: "desTajo"`.
- **S9** — The written name is `desTajo` (lowercase `des`, capital `T`) everywhere it is read. `name` and `appId` stay lowercase because they are identifiers.
- **S10** — The application icon is generated from `assets/destajo.svg` (amber tile, ink lowercase `d` whose ascender is the stem of a `T`) into `icon.png` and `icon.ico`, and the header badge shows `dT`.
- **S3** — The user data folder becomes `%APPDATA%\desTajo`. On first run, when the target has no `config.json`, the app copies `config.json`, `bugs/` and `copied/` from `%APPDATA%\NotiJira` or `%APPDATA%\notijira` when present. It copies, never moves, and never overwrites an existing file.
- **S4** — Read state migrates once from the `localStorage` key `notijira:readIds` to `destajo:readIds`.
- **S5** — `app.setAppUserModelId` uses `com.destajo.app`.
- **S6** — `README.md`, `AGENTS.md`, `.opencode/instructions.md` and `.atl/skill-registry.md` say `desTajo`. Historical `odd/tasks/*.md` logs are not rewritten.
- **S7** — Installer and portable artifacts are named `desTajo Setup <version>.exe` and `desTajo <version>.exe`.
- **S8** — Every existing `check:*` script still passes, and `check:rename` pins the S3 migration.

## Tasks

- [x] T1 `S1-S2` — `package.json` and `package-lock.json` name, appId, productName, shortcutName, description. Route: inline. Evidence: `373551d`.
- [x] T2 `S3, S5` — `main.js`: legacy user data migration, visible strings, AppUserModelId. Route: inline. Evidence: `373551d` + real start against `%APPDATA%\NotiJira` (config hash identical, 1 bug copied, legacy intact).
- [x] T3 `S1, S4` — `renderer/index.html` and `renderer/renderer.js`: title, header, logo, placeholder, read-state key and migration. Route: inline. Evidence: `373551d`.
- [x] T4 `S6, S7` — docs: `README.md`, `AGENTS.md`, `.opencode/instructions.md`, `.atl/skill-registry.md`. Route: inline. Evidence: `373551d`.
- [x] T5 `S8` — `scripts/test-support/electron-stub.js` paths and `scripts/check-rename-migration.js` plus its npm script. Route: inline. Evidence: `373551d`, 7/7 green.
- [x] T6 `S8` — verification: `node --check`, all `check:*` scripts, app start. Route: inline + independent verifier (data migration is high risk). Evidence: 13/13, 34/34, 27/27, 10/10, 45/45, 7/7.
- [x] T7 `S10` — `assets/destajo.svg`, `scripts/make-icon.js`, regenerated `icon.png`/`icon.ico`, header badge. Route: inline. Evidence: `373551d` plus the `d`+`T` ligature pass.

## Log

- L1 (user, verbatim): "Con el cotexto de esta aplicacion, necesito cambiarle el nombre a la aplicación, estoy girandola a tener varias herramientas que me ayudan al desarrollo."
- L2 (user): the app is personal and shared with the team, so ownability is secondary and the name must sound right in a team chat.
- L3 (user, verbatim): "nos quedamos con destajo". Name locked as `Destajo`; tagline carries the "dev" category instead of the name.
- L4 (decision): the rename changes `app.getPath('userData')`, so the existing `config.json`, `bugs/` and `copied/` would be orphaned. Migration copies from the legacy folders instead of moving, guarded by the presence of `config.json` in the target.
- L5 (decision): `appId` changes to `com.destajo.app`. Consequence: Windows treats desTajo as a different application, so the old NotiJira install must be uninstalled by hand and auto-update does not carry over. Recorded as an accepted cost of the rebrand.
- L6 (decision): historical `odd/tasks/*.md` logs keep the old name; only live documentation changes.
- L7 (user, verbatim): "Piensa tambien en el logo, hay que cambiarlo". The icon becomes a deliverable: new SVG source, regenerated PNG/ICO, header badge.
- L8 (user, verbatim): "quiero que se escriba en todos lados como desTajo". The written name is `desTajo` in every visible surface; `package.json` `name` and `appId` stay lowercase because npm and the Windows app identity treat them as identifiers.
- L9 (decision): the icon is an amber tile with an ink lowercase `d` whose ascender doubles as the stem of a `T`, so the mark carries both initials in one silhouette. The header badge shows `dT` to echo the camelCase.
- L10 (user, verbatim): "en el logo juega con la T tmb". The mark is a `d` + `T` ligature, not a lone `D`.
