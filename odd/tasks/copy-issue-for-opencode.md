# Copia de tarea para OpenCode

- Obetivo: buscador de tareas de Jira + modal para elegir pestañas/comentarios y copiar todo (con imágenes y archivos) al portapapeles en Markdown para pegarlo en el chat de OpenCode.
- Rama: `feature/copy-issue-for-opencode` (rama actual: `main`). Estrategia de entrega: `ask-on-risk` (pendiente de elegir cadena antes del primer commit).
- Test runner: no hay. Verificación con `node --check` en JS tocados + ejercicios funcionales `node -e` sobre el conversor ADF puro + checklist manual con `npm start`.

## Specs

### S1 — Buscador de tareas

> "sera un buscador (input) en el que le pondre el numero de tarea o una descripcion y buscará entre todas las tareas"

- Botón de búsqueda en la barra superior que abre un modal con un input.
- Si el texto coincide con el patrón `CLAVE-123` (p. ej. `CLIN-506`), se va directo a esa tarea (GET de la tarea; si no existe o no hay permiso, se muestra el error y se permite buscar igualmente).
- Si no, JQL `text ~ "<texto>" ORDER BY updated DESC` con máximo 20 resultados (búsqueda elegida por el usuario: "Todas las visibles": "JQL sobre todas las tareas que tú puedes ver en Jira, con máximo ~20 resultados ordenados por actualización más reciente").
- Resultados: clave, resumen, estado y fecha de actualización; al elegir uno se abre la modal de S2.

### S2 — Modal de selección de contenido

> "saldrá una modal para poder elegir que pestañas de las que existen en la tarea copiar, asi como se podrá elegir los comentarios a copiar"

Pestañas elegidas (verbatim del usuario): "Entrada, Preanalisis, contexto, Analisis funcional, Casos de prueba, Desglose funcional, Analisis técnico, QA, Gestion" y decisión posterior sobre Gestión: "Omitir Gestión".

Secciones ofrecidas (8) y su mapeo real verificado por API en la instancia Cloud:

| Sección | Campo | Tipo |
| --- | --- | --- |
| Entrada | `customfield_10090` | fecha (datetime) |
| PreAnálisis | `customfield_10218` | texto enriquecido ADF |
| Contexto | `customfield_10253` | texto enriquecido ADF |
| Análisis Funcional | `customfield_10250` | texto enriquecido ADF |
| Casos de Prueba | `customfield_10450` | texto enriquecido ADF |
| Desglose Funcional | `customfield_10448` | texto enriquecido ADF |
| Análisis Técnico | `customfield_10251` | texto enriquecido ADF |
| QA | `customfield_10481` | texto enriquecido ADF |

- Cada sección lleva checkbox; las secciones sin contenido se muestran deshabilitadas con aviso "sin contenido".
- Comentarios: checkbox individual por comentario con autor, fecha y vista previa; por defecto todos marcados.
- Asunción (no pedida): secciones de texto vacías → deshabilitadas; comentarios sin marcarse no se copian.

### S3 — Imágenes y archivos incluidos

> "Muy importante, lo que se copie debe incluir imagenes, archivos etc."

- Decisión del usuario (verbatim): "Descargar y enlazar": "Los adjuntos se descargan a una carpeta local y el texto copiado va en Markdown con rutas locales. OpenCode puede leer esas rutas y funciona con muchas imágenes y archivos a la vez."
- Imágenes insertadas dentro del ADF (`media`/`mediaSingle` de secciones y comentarios seleccionados) → descargadas con autenticación y referenciadas como `![](ruta-local)` dentro del Markdown.
- Adjuntos de la tarea (campo `attachment`): todos se descargan y se listan al final con su ruta local.
- Destino: `app.getPath('userData')/copied/<CLAVE>/`. Si la descarga falla, se conserva la URL absoluta de Jira como mejor esfuerzo y se avisa en el resultado.
- Asunción (no pedida): se descargan todos los adjuntos de la tarea, no solo los referenciados.

### S4 — Copia al portapapeles

> "Todo esto se copiará al portapapeles para llevarselo al chat de opencode para desarrollar tareas."

- Salida en Markdown, en este orden: encabezado (`# CLAVE — Resumen` + enlace a la tarea, siempre incluido — asunción), secciones seleccionadas en el orden de S2, comentarios seleccionados (autor · fecha + cuerpo), lista de adjuntos con rutas.
- Escritura al portapapeles desde el proceso principal (módulo `clipboard` de Electron).
- Respuesta a la UI: número de secciones, comentarios y archivos copiados + carpeta usada.

### S5 — Reglas del repositorio

- Toda cadena IPC nueva cableada en `main.js` (`ipcMain.handle`) + `preload.js` (`contextBridge`) + `renderer/renderer.js` (sitio de llamada).
- DOM con `createElement` + `textContent`; datos de Jira nunca a `innerHTML`.
- Texto de interfaz en español neutro; identificadores y comentarios en inglés (los comentarios nuevos siguen el idioma de los existentes).
- `adf.js` (nuevo archivo en la raíz) añadido a `build.files` en `package.json`.
- `node --check` limpio en todos los JS tocados.

## Tasks

| ID | Specs | Ruta | Estado | Commit |
| --- | --- | --- | --- | --- |
| T1 | S2,S3,S4 | inline | done | a71986d |
| T2 | S1,S2,S3,S4 | inline | done | c207f86 |
| T3 | S1,S2,S4 | inline | done | c207f86 |
| T4 | S1,S2,S3,S5 | inline | done | 9589074 |
| T5 | S1-S5 | inline | done | 9589074 |

- T1: `adf.js` — conversor ADF→Markdown puro (marks, listas, código, tablas, media, mention, status, emoji, enlaces) con resolución de medios a rutas locales; pruebas `node -e`.
- T2: `main.js` — `TAB_FIELDS`, `jira:searchIssues`, `jira:issueCopyData`, `copy:issue` (descargas + Markdown + clipboard), caché en memoria de los datos de la tarea.
- T3: `preload.js` — `searchIssues`, `getIssueCopyData`, `copyIssue`.
- T4: `renderer/` — botón de búsqueda en `index.html`, modal de búsqueda + modal de copia, lógica de selección y estilos.
- T5: verificación — `node --check`, ejercicios `node -e` del conversor (RED→GREEN), checklist manual `npm start`.

Ruta declarada: todas `inline` (sin trigger de delegación: el cambio es una sola conducta coherente con dependencias secuenciales entre partes, no hay unidades independientes en paralelo ni backstop de contexto).

### Evidencia de T5 (2026-10-31)

- `node --check` OK en `main.js`, `preload.js`, `adf.js`, `renderer/renderer.js`, `scripts/check-adf.js`.
- RED→GREEN del conversor: `MODULE_NOT_FOUND` inicial → fallo de separador de tabla → `ADF CHECKS: 13/13 passed` (exit 0). Commiteado como regresión: `npm run check:adf`.
- Chequeo estático cruzado: 36 IDs `getElementById` todos presentes en `index.html`; 9 canales `invoke` = 9 `ipcMain.handle`.
- Arranque real (`electron . --enable-logging`, 12 s): ventana "NotiJira" abierta, sin errores de preload/renderer; solo el aviso benigno de reinicio de network service de Chromium.
- Harness end-to-end con credenciales reales (solo lectura, scratch en TEMP): búsqueda por clave (1 exacta), búsqueda por texto (20 resultados), `issueCopyData` (8 secciones / 3 con contenido / 3 comentarios), copia → Markdown 2042 chars con cabecera, secciones y comentarios.
- Mock local de Jira (ejercita lo que la instancia no puede): 2 descargas (primario + fallback `/secure` forzado por 404), fichero con espacio `captura pantalla.png`, imagen inline en sección y en comentario resueltas a ruta local, sección Adjuntos con enlaces, sin token en la salida. `MOCK: TODO OK` (exit 0).
- Límite de inspección: la instancia no tiene ningún issue con adjuntos (`attachment is not empty` → `isLast=true, 0 issues`), por eso la descarga se probó con mock; en vivo no se pudo.
- Pendiente manual (DoD): `npm start` → Configuración → Probar conexion → Actualizar → Buscar → seleccionar → Copiar al portapapeles y pegar en OpenCode.

## Log

- L1 (petición original, verbatim): "Quiero hacer una nueva utilidad. sera un buscador (input) en el que le pondre el numero de tarea o una descripcion y buscará entre todas las tareas. Una vez seleccionada, saldrá una modal para poder elegir que pestañas de las que existen en la tarea copiar, asi como se podrá elegir los comentarios a copiar. Muy importante, lo que se copie debe incluir imagenes, archivos etc. Todo esto se copiará al portapapeles para llevarselo al chat de opencode para desarrollar tareas. Hazme las preguntas necesarias para el desarrollo"
- L2 (decisiones del usuario, verbatim):
  - Imágenes/archivos: "Descargar y enlazar (Recomendado)".
  - Secciones: "Dentro del campo Detalles claves vienen las pestañas Entrada, Preanalisis, contexto, Analisis funcional, Casos de prueba, Desglose funcional, Analisis técnico, QA, Gestion. El contenido de esas pestañas es lo que quiero".
  - Tipo de Jira: "No lo sé (Recomendado si dudas)" → inspeccionado: Jira Cloud (`salutic.atlassian.net`).
  - Búsqueda: "Todas las visibles (Recomendado)".
  - Origen de las pestañas: "Creo que son campos del panel de detalles, pero no lo se seguro, inpectionalo".
  - Gestión: "Omitir Gestión".
- L3 (evidencia de inspección, 2026-10-31): `/rest/api/3/field` devuelve 130 campos; 8 de 9 pestañas existen como campos propios (tabla de S2); `customfield_10090` "Entrada" es datetime; ningún campo se llama "Gestión"; descripción, comentarios y pestañas vienen en ADF (`{"type":"doc",...}`) vía api/3; JQL ilimitado devuelve 400 en esta instancia (siempre necesita `updated >= -Xd` o `text ~`); la API de issue layout no está expuesta (404 en todos los endpoints probados).
- L4 (decisiones de diseño): conversor ADF propio en `adf.js` (sin dependencias nuevas, política del repo); clipboard y descargas solo en el proceso principal; encabezado de tarea siempre incluido en la copia (asunción S3/S4).
- L5 (verificación, 2026-10-31): ver bloque "Evidencia de T5" arriba. Totales: ~1180 líneas autoras en 7 ficheros (`adf.js`, `main.js`, `preload.js`, `index.html`, `renderer.js`, `styles.css`, `scripts/check-adf.js`) más este documento.
- L6 (entrega): elegida `feature-branch-chain` por el usuario (verbatim de respuesta: "feature-branch-chain (Recomendado)"); 3 commits locales de unidades de trabajo creados en `feature/copy-issue-for-opencode` sin push ni PR. RDD activo (global `on`): evaluación por commit con `gentle-ai review assess --base-ref 2154eda --committed-only` → siempre `risk=medium`, `review_due=false`, `review_due_reason=under_budget` (slice queda pendiente de presupuesto; no abre review).
- L7 (cierre): Risk de la feature = item 3 (helper compartido `searchIssues` parameterizado con `maxResults`, usado además por el sondeo de notificaciones; default 100 preserva el comportamiento previo) → se escala con `--escalate-item 3` y verificador independiente sobre el diff completo. Prueba de descargas solo con mock (la instancia no tiene adjuntos). DoD manual (`npm start` interactivo) pendiente de ejecución por el usuario.
- L8 (verificador + corrección, 2026-10-31): verificador independiente (`gentle-ai-verify`) → S2, S3(mock), S5 y el diferencial del item 3 PASS; S1 y S4 FAIL con 2 blockers: B1 clave inexistente (404) se perdía en silencio (la spec S1 exige "se muestra el error y se permite buscar igualmente"), B2 `copy:issue` no devolvía la carpeta usada (exigido en S4). Batch único de corrección con sus probes de regresión (`scripts/check-copy-flow.js` + `scripts/test-support/electron-stub.js`, `npm run check:copy`): RED 11/13 → fix (`searchIssuesForCopy` aviso no fatal en 404 mostrado en la UI junto a los resultados; `folder` en la respuesta de copia y en la barra de estado) → GREEN 13/13. Advisories del verificador sin corregir (son no bloqueantes): enlace de tarea como URL desnuda en Markdown, media sin `attachment` asociado se guarda como `adjunto-<id>` sin extensión, caché de copia indexada solo por clave de tarea, `decodeHtml`/`stripHtml` con `innerHTML` preexistente del baseline. Scratch del verificador a borrar: `%TEMP%\verify-03d00b53`.
