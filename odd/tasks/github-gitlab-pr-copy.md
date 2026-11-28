# Soporte de GitLab y GitHub para diffs de MR/PR en copia de Jira (v2.1.0)

- Objective: habilitar en desTajo v2.1.0 la configuracion de credenciales tanto de GitLab como de GitHub, permitiendo seleccionar el proveedor y obtener los diffs de MR/PR para adjuntarlos al Markdown copiado de Jira.
- Branch: `feature/github-gitlab-pr-diff`
- Test runner: `npm run check:copy`, `npm run check:renderer`, `node scripts/check-*.js` (arnes headless propio sin frameworks).

---

## Analisis arquitectonico y estado actual

Actualmente la aplicacion (`desTajo` v2.0.0):
1. **Configuracion (`config.json`)**: solo persiste `gitlabUrl` y `gitlabToken` junto a las credenciales de Jira y de la bandeja de incidencias.
2. **Interfaz de Ajustes (`#modal`)**: dispone unicamente de una seccion para GitLab con campos para URL y Token, y botones para guardar/eliminar credenciales.
3. **Modal de Copia (`#copyModal`)**: tiene un checkbox "Obtener MR" (`#includeMrCheckbox`) fuertemente acoplado a GitLab (`#gitlabSelection`), el cual abre 3 comboboxes (`gitlabProjectInput`, `gitlabSourceBranchInput`, `gitlabTargetBranchInput`).
4. **Proceso Principal (`main.js`)**: implementa clientes HTTP propios para Jira y GitLab usando `fetch` nativo de Node. Maneja redirecciones con `redirect: 'error'`, validacion estricta de URL HTTPS y comparacion de ramas mediante el endpoint `/projects/:id/repository/compare`.
5. **IPC y Preload**: canales `gitlab:projects`, `gitlab:branches` y `copy:issue` (este ultimo recibe `includeMr` y el objeto `gitlab`).

### Principios de diseno para la v2.1.0

- **CONCEPTS > CODE**: no duplicar componentes UI ni clientes de red sin abstraccion. El componente reutilizable `createCombo` ya existente en `renderer.js` debe alimentar tanto a GitLab como a GitHub.
- **SOLID & Extensibilidad**: el flujo de diff debe desacoplarse del concepto exclusivo "MR de GitLab" a un concepto generico de "Proveedor Git (MR / PR)".
- **Seguridad estricta**:
  - Tokens de GitHub (Personal Access Tokens clásicos o fine-grained) tratados como secretos: nunca en logs, nunca en Markdown copiado, almacenamiento en `config.json`.
  - Validacion de URL de GitHub: por defecto `https://api.github.com`, permitiendo instancias de GitHub Enterprise con HTTPS obligatorio (salvo loopback local para pruebas).
  - Rechazo explicito de redirecciones (`redirect: 'error'`) para evitar fugas del token en saltos HTTP.

---

## Specs

### S1 — Persistencia de credenciales de GitHub en `config.json`
- Anadir soporte en el proceso principal (`main.js`) para almacenar y leer:
  - `githubToken`: token de acceso personal (PAT).
  - `githubUrl`: opcional, por defecto `https://api.github.com` si se deja vacio; valida HTTPS estricto o loopback.
- Mantener compatibilidad absoluta hacia atras con `gitlabUrl` y `gitlabToken`.
- Metodos de guardado y borrado de credenciales de GitHub independientes de las de GitLab.
- Check: comprobar en `scripts/check-copy-flow.js` que las credenciales de GitHub se guardan, persisten, leen y eliminan sin alterar las de Jira ni las de GitLab.

### S2 — Seccion de credenciales de GitHub en la ventana de Ajustes
- En `renderer/index.html` y `renderer/renderer.js`:
  - Anadir seccion "GitHub" en el formulario de configuracion con inputs para URL (opcional/placeholder `https://api.github.com`) y Token (`#githubToken`).
  - Botones "Guardar credenciales de GitHub" y "Eliminar credenciales de GitHub".
  - Manejo de mensajes de error/exito claros (`setFormMessage`).
- Si el usuario intenta obtener un diff de GitHub sin credenciales configuradas, la aplicacion abre la pantalla de configuracion enfocando el campo de GitHub.

### S3 — Cliente REST de GitHub en proceso principal (`main.js`)
- `normalizeGitHubBaseUrl(url)`: asegura prefijo HTTPS, elimina barras finales y establece por defecto `https://api.github.com`.
- `githubRequest(config, endpoint, options)`:
  - Headers: `Authorization: Bearer <githubToken>`, `Accept: application/vnd.github+json`, `User-Agent: desTajo`, `X-GitHub-Api-Version: 2022-11-28`.
  - `redirect: 'error'`.
- `getGitHubRepositories(config, search)`:
  - Consulta repositorios accesibles por el usuario (`GET /user/repos?per_page=100&sort=updated` o busqueda de repositorios `GET /search/repositories?q=user:@me+<search>`).
  - Devuelve `{ ok: true, repos: [{ id, name, fullName, defaultBranch, private }], truncated }`.
- `getGitHubBranches(config, owner, repo, search)`:
  - Consulta ramas del repositorio (`GET /repos/{owner}/{repo}/branches?per_page=100`).
  - Devuelve `{ ok: true, branches: [{ name }], truncated }`.
- `compareGitHubBranches(config, selection)`:
  - Consulta endpoint de comparacion: `GET /repos/{owner}/{repo}/compare/{base}...{head}` donde `base` es la rama destino (p. ej. `develop` o `main`) y `head` es la rama origen (la clave Jira o rama de feature).
  - Alternativa eficiente de GitHub: usar cabecera `Accept: application/vnd.github.v3.diff` para obtener el diff unificado completo, o procesar la lista `comparison.files` con `patch`.
  - Validacion de limites: rechazo si el diff supera umbrales o viene incompleto.

### S4 — Selector de proveedor Git y unificacion de comboboxes en la Modal de Copia
- Renombrar el checkbox `#includeMrCheckbox` a "Obtener diff (MR / PR)".
- Cuando el checkbox este activo, comportamiento segun credenciales:
  - **Solo un proveedor configurado (GitLab o GitHub)**: NO se muestra selector ni se pregunta al usuario; se selecciona y activa directamente ese proveedor, mostrando de inmediato sus buscadores. Cero friccion.
  - **Ambos proveedores configurados**: se muestra un selector rapido (tabs/radio: GitLab | GitHub) para elegir el proveedor de la tarea. Se recuerda la ultima eleccion activa.
  - **Ningun proveedor configurado**: se informa y se redirige a Ajustes para anadir credenciales de al menos uno.
- Buscadores para GitHub:
  - Buscador de Repositorio (`#githubRepoInput` y `#githubRepoList`).
  - Buscador de Rama Origen (`#githubSourceBranchInput`, busca por defecto la clave Jira `AAA-1`).
  - Buscador de Rama Destino (`#githubTargetBranchInput`, busca por defecto `develop` o la rama por defecto del repo).

### S5 — Formato de salida Markdown para diffs de PR
- Integracion en `copyIssueToClipboard`:
  - Si el proveedor es GitLab:
    ```markdown
    ## Diff de MR — {proyecto} · {origen} → {destino}
    ```
  - Si el proveedor es GitHub:
    ```markdown
    ## Diff de PR — {owner/repo} · {origen} → {destino}
    ```
  - Bloque de codigo con lenguaje `diff`, protegiendo escapes de tildes graves (backticks).

### S6 — Extension del contrato IPC y Preload
- Nuevos canales IPC:
  - `github:repos`: `{ config, search }` -> `{ ok, repos, truncated }`
  - `github:branches`: `{ config, owner, repo, search }` -> `{ ok, branches, truncated }`
- Actualizacion de `copy:issue`:
  - Payload ampliado:
    ```json
    {
      "includeMr": true,
      "provider": "gitlab" | "github",
      "gitlab": { "projectId", "projectName", "sourceBranch", "targetBranch" },
      "github": { "owner", "repo", "fullName", "sourceBranch", "targetBranch" }
    }
    ```
  - Mantener total compatibilidad con cargas antiguas que omitan `provider`.

### S7 — Suite de pruebas y regresion
- Anadir servidor simulado de GitHub en `scripts/check-copy-flow.js` con endpoints `/user/repos`, `/repos/:owner/:repo/branches` y `/repos/:owner/:repo/compare/...`.
- Anadir aserciones para:
  - Guardado, recuperacion y borrado de credenciales de GitHub sin tocar Jira ni GitLab.
  - Busqueda en servidor con `search` de repositorios y ramas de GitHub.
  - Comparacion de ramas de GitHub y agregado del diff al Markdown copiado.
  - Rechazo de URLs HTTP no locales y proteccion contra redirecciones con token.
- Actualizar o ampliar `scripts/check-renderer-gitlab.js` para comprobar la alternancia entre proveedores y la validacion de campos requeridos antes de copiar.

### S8 — Actualizacion a version 2.1.0 y Documentacion
- Subir version en `package.json` y `package-lock.json` a `2.1.0`.
- Actualizar `AGENTS.md`, `.opencode/instructions.md` y `README.md` documentando la nueva capacidad multi-proveedor (GitLab + GitHub) y la nueva interfaz de ajustes.

### S9 — Rediseño de la interfaz de configuracion a doble columna (Sidebar + Contenido)
- Inspirado en la interfaz de preferencias moderna (estilo OpenCode / VSCode) pero adaptado estrictamente a la paleta retro-neon de desTajo (`#0b0f0d`, `#121a16`, mint `#6ee787`, bordes `#23322b` y sombras nítidas).
- **Estructura en dos columnas**:
  - **Sidebar lateral izquierda (`.settings-sidebar`)**:
    - Botón superior "← Volver a la aplicación" / Cerrar.
    - Menú de navegación por categorías con iconos y etiquetas:
      1. `Jira` (Conexión, usuario, API token).
      2. `Proveedores Git` (GitLab y GitHub con subsecciones o tabs limpios).
      3. `Captura rápida` (Atajo global y arranque con Windows).
      4. `Actualizaciones` (Servidor de updates y versión).
      5. `Acerca de` (Información de la app, versión 2.1.0, licencia).
  - **Panel de contenido principal (`.settings-content`)**:
    - Cabecera con título de sección y descripción contextual.
    - Filas y tarjetas agrupadas limpiamente, evitando formularios verticales interminables con scroll forzado.
    - Acciones de pie fijas o contextuales (Probar conexión, Guardar, Cancelar).
- Mantiene exactamente los mismos IDs y atributos de los inputs para garantizar compatibilidad total con los tests headless (`check:copy`, `check:renderer`, `check:bugs`).

---

## Tasks

| ID | Specs | Ruta | Estado | Descripcion |
| --- | --- | --- | --- | --- |
| **T1** | S1, S2 | inline | ✅ completada | Configuracion de GitHub en `main.js` (lectura/escritura en `config.json`, validacion HTTPS). |
| **T2** | S9 | inline | ✅ completada | Rediseño de la modal de configuracion a doble columna (sidebar con categorías + panel de contenido) en `renderer/index.html` y `renderer/styles.css` respetando los estilos de desTajo. |
| **T3** | S3, S5 | inline | ✅ completada | Implementacion del cliente GitHub en `main.js` (`githubRequest`, `getGitHubRepositories`, `getGitHubBranches`, `compareGitHubBranches`, formateo del diff). |
| **T4** | S6 | inline | ✅ completada | Exposicion de canales IPC en `main.js` (`github:repos`, `github:branches`) y en `preload.js` (`window.api.getGithubRepositories`, etc.). |
| **T5** | S4 | inline | ✅ completada | UI en modal de copia: selector de proveedor (GitLab / GitHub), comboboxes de repositorio y ramas de GitHub reutilizando `createCombo`, seleccion automatica sin preguntar cuando solo haya uno configurado. |
| **T6** | S5, S6 | inline | ✅ completada | Adaptacion del handler `copy:issue` para procesar el diff segun el proveedor seleccionado (`gitlab` o `github`) y anexarlo al portapapeles. |
| **T7** | S7 | inline | ✅ completada | Extension del arnes de tests en `scripts/check-copy-flow.js` (17 nuevos checks GitHub, total 51) para cubrir los flujos de GitHub y asegurar que todos los checks pasen al 100%. |
| **T8** | S8 | inline | ✅ completada | Incremento de version a 2.1.0 en `package.json` y `package-lock.json`, actualizacion de `README.md`, `AGENTS.md` e `instructions.md`. |

---

## Riesgos y mitigaciones tecnicas

1. **API Rate Limiting en GitHub**:
   - *Riesgo*: la API de GitHub para usuarios autenticados tiene limite de 5.000 req/hora. Busquedas por tecla no debounced podrian agotar la cuota.
   - *Mitigacion*: aplicar estrictamente el debounce de 250 ms ya existente en `createCombo`, y limitar a la primera pagina de resultados.
2. **Formato de repositorios de GitHub (Owner / Repo)**:
   - *Riesgo*: en GitLab se usa un `projectId` numerico o un path namespaced simple, mientras que en GitHub los endpoints de ramas y comparacion requieren `{owner}/{repo}`.
   - *Mitigacion*: modelar el elemento seleccionado con `owner`, `repo` y `fullName` claramente tipados en el combo de repositorios.
3. **Manejo de diffs grandes en GitHub**:
   - *Riesgo*: comparaciones con miles de lineas pueden bloquear o degradar el rendimiento del portapapeles.
   - *Mitigacion*: comprobar el flag o cabeceras de truncado de GitHub y limitar o advertir cuando el diff exceda limites razonables (al igual que se hace con `comparison.overflow` en GitLab).
4. **Coexistencia y transicion suave**:
   - *Riesgo*: usuarios existentes que solo usan GitLab no deben ver rota su experiencia ni requerir reconfiguracion.
   - *Mitigacion*: si solo hay credenciales de GitLab, la UI se comporta de forma identica a la 2.0.0, ocultando friccion innecesaria.
