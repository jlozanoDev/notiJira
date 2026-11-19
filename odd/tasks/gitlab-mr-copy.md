# GitLab merge-request diff in Jira copy
- Objective: add GitLab project/branch selection and append the merge-request diff to the existing Jira Markdown copy, then publish NotiJira 1.1.0.
- Branch: `feature/gitlab-mr-copy`. Delivery strategy: `ask-on-risk`; forecast exceeds approximately 400 authored lines, so choose a chain strategy before the first commit.
- Test runner: no general suite; use `npm run check:copy`, `npm run check:adf`, `node --check` on touched JavaScript, GitLab API mocks, and the authorized package/release checks.

## Specs

### S1 — GitLab project, branch, and diff selection

> "Quiero añadir un nuevo check box que será obtener MR."
>
> "Esto lo que hará es preguntar rama origen y rama destino, obteniendolas de gitlab."
>
> "una vez conectado con url y token que permita elegir cual es el proyecto, consultando gitlab"

- Add an “Obtener MR” checkbox to the existing copy-selection flow.
- With GitLab credentials available, query GitLab for projects visible to that credential and let the user choose a project; then let the user choose source and target branches fetched from that project.
- Fetch the comparison for the selected source and target branches and append its diff after the Markdown content already copied.
- Assumption: project, source branch, and target branch are selected in the copy flow for each operation; the selected project is not persisted as the only available project.
- Check: mock GitLab project, branch, and comparison responses; assert the selected refs and appended diff, including API errors and empty comparisons.

### S2 — GitLab credential setup and removal

> "Para ello si no tiene las credenciales, url token lo pedirá."
>
> "Ademas en la configuracion tambien abrá un apartado para eliminar y crear credenciales de gitlab."

- Provide GitLab URL and token setup in application settings, with a way to remove the saved GitLab credentials.
- If the user requests an MR without credentials, ask for the URL and token before querying GitLab.
- Assumption: credentials use the app’s existing local `config.json` persistence pattern and are never written to logs or included in copied Markdown.
- Check: exercise save, reload, remove, and missing-credential flows with isolated user-data state; confirm token absence from UI status and copied output.

### S3 — Version and release

> "Tienes que crear el tag 1.1.0, cambiar la versión de la aplicación y generar la release en github y cambiar el readme incluyendo el exe setup etc"

- Set the application version to `1.1.0`, build the Windows setup and portable executables, create the matching GitHub tag/release, and update README download links to the release assets.
- The repository’s local release tag uses a `v` prefix (`v1.0.2`); create `v1.1.0` for this release.
- Remote release, tag, and asset publication require explicit authorization for the exact GitHub credential/session before any remote operation.
- Check: version consistency, generated installer/portable asset names, release/tag identity and assets, README links.

### S4 — Repository contracts and verification

- Preserve the existing Jira copy behavior and main-process ownership of clipboard and network I/O.
- Keep renderer DOM construction safe (`createElement` and `textContent` for remote data), and keep GitLab secrets out of logs and copied Markdown.
- Security assumption: require HTTPS for GitLab URLs, except loopback HTTP used by local test servers.
- Wire any new IPC capabilities through `main.js`, `preload.js`, and `renderer/renderer.js`.
- Check: test-first RED → GREEN where the current deterministic mock harness supports it; `npm run check:copy`, `npm run check:adf`, `node --check` on all touched JavaScript, structural IPC/UI checks, and an independent security-focused verification of credential handling.
- Risk: items 2 and 4 (GitLab credentials are secrets; overlapping asynchronous project/branch requests must not overwrite newer selections).

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S2, S4 | inline | done | 4f26c34 |
| T2 | S1, S4 | inline | done | 4f26c34 |
| T3 | S3, S4 | inline | done — release v1.1.0 publicada | ad66f8e |
| T4 | S1-S4 | delegated verifier after implementation checks | done | 4f26c34 + ad66f8e |

- T1: GitLab credential setup/removal, authenticated project listing, and project choice.
- T2: branch listing, source/target selection, comparison retrieval, and diff appended to the existing Markdown copy.
- T3: version update, packaging, README release links, and authorized GitHub publication.
- T4: independent verification of the completed credential-sensitive and asynchronous change; the parent performs the required assessment and spot check.
- T3 risk: item 5 (Windows packaging and release delivery affect the shipped application).
- Route evidence: implementation is one dependency-ordered feature and has no parallel writer reason; implementation stays inline. The independent verifier is required by Risk items 2 and 4.

## Log

- L1 (original request, verbatim): "Vale en la utilidad de copiar de jira. El buscador de arriba, cuando encuentra y entramos en la tarea y seleccionakmos las distintas pesatañas y comentarios. Quiero añadir un nuevo check box que será obtener MR. Esto lo que hará es preguntar rama origen y rama destino, obteniendolas de gitlab. Y al darle a aceptar junto todo lo que copiaba anteriormente, ademas generará el diff al final del copiado. Para ello si no tiene las credenciales, url token lo pedirá. Ademas en la configuracion tambien abrá un apartado para eliminar y crear credenciales de gitlab. Tienes que crear el tag 1.1.0, cambiar la versión de la aplicación y generar la release en github y cambiar el readme incluyendo el exe setup etc"
- L2 (clarification, verbatim): "una vez conectado con url y token que permita elegir cual es el proyecto, consultando gitlab"
- L3: CodeGraph index was initialized and verified; the copy flow is in `main.js` and `renderer/renderer.js`. The app is plain CommonJS Electron with no general suite; existing flow checks use mocked dependencies.
- L4: The feature branch `feature/gitlab-mr-copy` was created from `main`. Working tree was clean before the branch was created.
- L5: GitLab’s documented REST API supports listing projects with an access token and comparing refs with `GET /projects/:id/repository/compare`; use GitLab API access only from the main process.
- L6: Before any GitHub remote operation, the user must specify/authorize the exact credential or session to use. The project-selection clarification is resolved; missing GitLab credentials should prompt for setup.
- L7: T1 completed inline: GitLab credentials can be saved/read/removed without losing Jira config, and authenticated project listing is wired. The initial RED run failed the three new GitLab expectations; the focused suite now passes 21/21, and `node --check` passes for all touched JavaScript files.
- L8: T2 completed inline: project and branch selectors call the main-process GitLab API; copying appends the target-to-source comparison after the existing Jira Markdown. Tests cover empty comparisons, timeouts, incomplete diffs, and missing credentials without overwriting the clipboard; `npm run check:copy` passes 21/21.
- L9 (corrección de riesgo): `gitlab:projects` y `gitlab:branches` responden `{ ok, ... }` o `{ ok: false, error }` como el resto de handlers; `normalizeGitLabBaseUrl` exige HTTPS salvo loopback; las peticiones de GitLab usan `redirect: 'error'`; el bloque "sin selección" se comprueba antes de consultar GitLab; y el panel de proyectos/ramas cancela respuestas atrasadas con `state.gitlabRequestId`. Pruebas añadidas: HTTP no local rechazado, redirección no seguida sin filtrar el token, sin credenciales no se toca el portapapeles, comparación vacía, timeout/diff incompleto, y que el token no aparece en el Markdown. `npm run check:copy` pasa 22/22 y `npm run check:adf` 13/13; la comprobación diferencial (guardar/leer configuración y `copy:issue` con `includeMr: false`) da salida idéntica a la línea base tras normalizar el puerto efímero.
- L10 (UI, petición del usuario, verbatim): "modifica para que el check de mr este arriba a la derecha junto al titulo de la for-". El check "Obtener MR" se movió a una cabecera `.copy-header` junto a `#copyTitle`, alineado a la derecha, y el panel de proyecto/ramas quedó justo debajo del subtítulo para que aparezca junto al check. Aserción estructural nueva en `scripts/check-copy-flow.js` (RED → GREEN); suite 23/23. Riesgo: ninguno (solo marcado y estilos; IDs y contrato IPC intactos).
- L11 (batch de corrección único, sobre los bloqueantes del verificador): `config:save` captura y devuelve `{ ok: false, error }` sin escribir nada cuando la URL de GitLab es inválida (la configuración anterior queda intacta byte a byte) → B1. El renderer comprueba `result.ok`, releé `getConfig()` para quedarse con lo normalizado y usa `restoreCopyModalAfterGitlabSetup()`, que reabre la copia con el check activo y el panel visible → B2. Añadido: validación estricta de hostname (A2), error de conexión claro en lugar de `fetch failed` (A3) y rechazo explícito de `comparison.overflow` (A1). A4 (`config:get` devuelve el token) se acepta como patrón heredado de `apiToken` y no se cambia en esta entrega. Nuevos sondeadores de regresión: `scripts/test-support/renderer-stub.js` (DOM mínimo + `window.api`) y `scripts/check-renderer-gitlab.js` (`npm run check:renderer`, 8 aserciones), más 5 aserciones nuevas en `check:copy` (26 en total). Prueba de mutación: reintroducir B1 hace fallar `check:copy` 24/26; reintroducir B2 hace fallar `check:renderer` 6/8; reintroducir A1 hace fallar `check:copy` 25/26.
- L12 (descubrimiento del arnés): `check-copy-flow.js` se colgaba si `require('main.js')` fallaba porque el servidor HTTP simulado seguía escuchando; ahora un `finally` lo cierra siempre. Lanzar los checkers desde fuera del repo exige `NODE_PATH` apuntando a los `node_modules` del repo.
- L13 (T3): versión 1.1.0 en `package.json` y `package-lock.json`, README y docs de agentes actualizados. Los `dist/` generados antes de L11/L12 quedan obsoletos: hay que reconstruirlos antes de publicar.
- L14 (pendiente): el usuario pidió tag, release en GitHub y subida de instaladores; es una operación remota. Falta su autorización explícita sobre la credencial/sesión de GitHub a usar antes de tocar el remoto.
- L15 (corrección del verificador, batch único): B1 `config:save` devuelve `{ ok:false, error }` y no escribe nada con una URL de GitLab inválida (la config anterior queda intacta byte a byte); el renderer comprueba `result.ok` y releé `getConfig()`. B2 `restoreCopyModalAfterGitlabSetup()` reabre la copia con el check activo y el panel visible. A1 `comparison.overflow` rechazado; A2 hostname estricto; A3 error de conexión claro en vez de `fetch failed`. A4 (`config:get` devuelve el token) se acepta como patrón heredado de `apiToken`. Sondas fijadas por mutación: reintroducir B1 → `check:copy` 24/26; B2 → `check:renderer` 6/8; A1 → `check:copy` 25/26.
- L16 (revisión nativa RDD): evaluación escalada a `high` (item 2) sobre `21f9fd9`; consentimiento concedido por el humano; `review start` creó el linaje `review-a449c799828a91cc` con 3 lentes. El `review status` vinculado devolvió `operation_timeout` en `pre_native` (`retry_safe:false`, `next_action:stop`, `mutation_outcome:not_started`): no se relanzó ni se abandonó el linaje, no hay receipt y la entrega siguió la política ordinaria. Reportado como ocurrencia en Gentle AI #6153 (comentario `7021107337`).
- L17 (publicación, autorización explícita del usuario: sesión `gh` de `jlozanoDev` sobre `jlozanoDev/notiJira`): rama subida, PR #2 creado y fusionado a `main` con merge commit `2d04cba` (árbol idéntico al commit del que se compilaron los instaladores), tag anotado `v1.1.0` → `2d04cba` empujado, release `v1.1.0` publicada (2026-11-19T20:25:00Z) con `NotiJira.Setup.1.1.0.exe` (76.550.989 B) y `NotiJira.1.1.0.exe` (76.335.512 B); ambas URLs devuelven HTTP 200. GitHub convierte los espacios del nombre en puntos, por lo que el README enlaza los nombres con puntos.
- L18 (cierre): fix `07c6304` en `main` corrige el README y la nota de la release a los nombres reales de los assets y documenta la conversión espacios→puntos. Ejecución real: `electron . --enable-logging` mantuvo la ventana viva 12 s sin errores en stderr. Suite final en `main`: `check:copy` 26/26, `check:renderer` 8/8, `check:adf` 13/13, `git diff --check` limpio, árbol de trabajo limpio. Queda pendiente solo la DoD interactiva del usuario (`npm start` → configurar GitLab → marcar Obtener MR → pegar la copia en OpenCode). Feature cerrada; la rama `feature/gitlab-mr-copy` se conserva en el remoto.
