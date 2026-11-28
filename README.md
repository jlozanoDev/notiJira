# desTajo

desTajo (antes **NotiJira**) es una aplicación de escritorio para Windows con herramientas para el día a día del desarrollo: vigila Jira y te avisa cuando te mencionan en un comentario, copia una tarea a Markdown con el diff de GitLab, y te deja apuntar un bug en segundos mientras trabajas, con imágenes y enlaces, para crear la tarea después. Todo corre en local: sin servidor propio, sin telemetría y sin cuentas adicionales.

## Descargar

Hasta la versión 1.2.0 la aplicación se llamó **NotiJira**. A partir de la versión 2.0.0, la aplicación pasa a ser **desTajo** y los instaladores se publican como `desTajo Setup <versión>.exe` y `desTajo <versión>.exe`.

[Descargar desTajo v2.1.0 en GitHub](https://github.com/jlozanoDev/destajo/releases/tag/v2.1.0). En **Assets**, elige `desTajo.Setup.2.1.0.exe` para instalar o `desTajo.2.1.0.exe` para usar la versión portable.

## Ruta rápida

1. `npm install`
2. `npm start`
3. Pulsa **Configuracion** e introduce la URL de tu Jira, tu email y tu API token.
4. Pulsa **Probar conexion** y después **Guardar**.
5. Opcionalmente, configura la URL HTTPS y el token de GitLab en el apartado **Proveedores Git → GitLab**, y/o el token de GitHub en **Proveedores Git → GitHub** para incluir diffs de MR/PR al copiar una tarea.
6. Para apuntar un bug desde cualquier aplicación, pulsa `Ctrl+Alt+J` (se cambia en **Configuracion → Captura rapida**) o el icono de la bandeja.

Desde ese momento la app revisa tus menciones cada 5 minutos y muestra una notificación nativa (con sonido) cuando aparece una nueva.

## Requisitos

- Node.js 18 o superior, solo para desarrollo. La app empaquetada no lo necesita.
- Jira Cloud con un API token, o Jira Server/Data Center con un Personal Access Token.

## Autenticación

| Jira | Email | Token |
| --- | --- | --- |
| Cloud | El email de tu cuenta de Atlassian | API token de `id.atlassian.com` |
| Server / Data Center | Déjalo vacío | Personal Access Token |

Con email, la app envía `Basic <email:token>`; sin email, envía `Bearer <token>`.

El token de Jira se guarda en texto plano en `config.json` dentro de la carpeta de datos de usuario de la aplicación. No se registra en logs ni se envía a ningún sitio que no sea tu propio Jira.

## Proveedores Git (GitLab + GitHub)

En **Configuracion → Proveedores Git** puedes configurar **GitLab** y **GitHub** de forma independiente:

- **GitLab**: introduce la URL HTTPS de tu instancia y un token de acceso con permiso `api`. La aplicación busca en GitLab los proyectos accesibles para ese token.
- **GitHub**: introduce un Personal Access Token (clásico o fine-grained) con permiso `repo`. La URL por defecto es `https://api.github.com`; puedes cambiarla para GitHub Enterprise Server. El token se valida como secreto y solo se envía a la URL configurada.

Al marcar **Obtener diff (MR / PR)** al copiar una tarea, el comportamiento depende de los proveedores configurados:

- **Solo uno configurado** (GitLab o GitHub): se selecciona automáticamente y muestra sus buscadores sin preguntar.
- **Ambos configurados**: aparece un selector rápido (GitLab | GitHub) para elegir el proveedor de la tarea; se recuerda la última elección.
- **Ninguno configurado**: se informa y se redirige a la pantalla de configuración.

Buscadores para **GitLab** (proyecto, rama origen, rama destino) y **GitHub** (repositorio, rama origen, rama destino):
- Cada texto se envía al proveedor (parámetro `search`, con retardo de un cuarto de segundo) y sugiere lo que coincida.
- Se elige con un clic o con las flechas + `Enter`; `Escape` cierra sin perder la elección anterior.
- Al elegir un proyecto/repositorio, el buscador de origen empieza por la clave de la tarea Jira y el de destino por `develop` (o la rama por defecto del repo en GitHub). Si el proveedor devuelve una rama que coincide exactamente, queda seleccionada automáticamente.
- Cada búsqueda trae una página de 100 resultados. Si el proveedor la llena, el aviso te pide que concretes más el texto.

El diff de la comparación se añade al final del Markdown copiado:
- **GitLab**: `## Diff de MR — {proyecto} · {origen} → {destino}`
- **GitHub**: `## Diff de PR — {owner/repo} · {origen} → {destino}`

Las credenciales se guardan en texto plano junto a la configuración local; puedes eliminarlas desde el mismo apartado. Los tokens nunca se incluyen en logs ni en el texto copiado. HTTP solo se admite para pruebas en `localhost`.

## Capturar incidencias

Mientras desarrollas, el bug suele aparecer en el navegador, en la consola o en un mensaje de Slack: no cuando la app de Jira está delante. Por eso la captura es una ventana propia que se abre con un **atajo global** (`Ctrl+Alt+J` por defecto) con cualquier aplicación en primer plano, y también desde el icono de la bandeja.

- La ventana pide poco a propósito: **título** (obligatorio), detalles, enlaces e imágenes. `Enter` en el título guarda y cierra; `Ctrl+Enter` guarda desde cualquier campo; `Esc` cierra **conservando un borrador** que se recupera al volver a abrir la ventana.
- Las imágenes se añaden pegándolas (`Ctrl+V`), arrastrándolas o con el selector. Se ven como miniaturas y se pueden quitar. Límites: 10 MB por imagen y 20 por incidencia; lo que no encaja se descarta avisando.
- Los enlaces se etiquetan solos según su origen: **Slack**, **Jira**, **Web** u **Otro**. Si pegas un `/browse/CLIN-530`, además rellena el issue relacionado. Al abrir la ventana, si el portapapeles contiene una única URL te la ofrece como enlace, y el campo de issue parte del último issue que usaste en la utilidad de copia.
- Todo se guarda en tu equipo, en la carpeta de datos de usuario (`bugs/<identificador>/` con `nota.json` y las imágenes). No hay índice central ni sincronización: puedes copiar la incidencia como Markdown, copiar las rutas de las imágenes o abrir la carpeta para arrastrarlas donde quieras.
- El ciclo se cierra a mano: **no se crea ninguna tarea en Jira**. Cuando tú has creado la issue, escribes su clave en **Marcar como creada** y la incidencia pasa a **Creadas**, con enlace a Jira y fecha. Las pestañas de la bandeja son **Pendientes / Creadas / Todas**, con buscador de texto.

El atajo es configurable: en **Configuracion → Captura rapida** pulsas la combinación y se guarda. Si otra aplicación ya usa esa combinación, la app recupera la anterior y te avisa, así que nunca te quedas sin capturar. Ahí mismo puedes activar **Arrancar con Windows** (solo tiene efecto en la versión instalada). Cerrar la ventana principal no cierra la aplicación mientras exista el icono de bandeja: desde **Salir** del menú de la bandeja se cierra de verdad.

## Qué hace

| Comportamiento | Detalle |
| --- | --- |
| Búsqueda | Comentarios de los últimos 90 días donde apareces mencionado |
| Refresco | Automático cada 5 minutos, y manual con **Actualizar** |
| Avisos | Notificación nativa de Windows + tono al detectar menciones nuevas |
| Filtros | No leídas, leídas y todas, con contadores |
| Estado de lectura | Se guarda en el equipo (`localStorage`), no en Jira |
| Abrir en Jira | Al pulsar una tarjeta se abre el comentario en el navegador |
| Buscar y copiar | Buscador de tareas por clave o texto y copia al portapapeles, en Markdown, de las pestañas y comentarios elegidos, con imágenes y archivos descargados localmente |
| Diff de GitLab / GitHub | Al activar **Obtener diff (MR / PR)**, eliges el proveedor (si hay dos) y buscas el proyecto/repositorio y las ramas con sugerencias; añade la comparación al final de la copia |
| Capturar incidencias | Ventana propia abierta con atajo global desde cualquier aplicación: título, detalles, enlaces clasificados (Slack, Jira, web), imágenes pegadas o arrastradas y borrador al cerrar |
| Bandeja de incidencias | Listado local con pestañas Pendientes / Creadas / Todas, buscador, contador en la barra, copia como Markdown y registro de la clave de Jira al crear la tarea a mano |
| Actualizaciones | Comprobación automática cada 6 horas en la versión empaquetada |

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm start` | Abre la app en modo desarrollo |
| `npm run pack` | Genera la app sin instalador en `dist/` |
| `npm run dist` | Genera el instalador NSIS y la versión portable en `dist/` |
| `npm run check:adf` | Comprueba el conversor ADF→Markdown (13 aserciones) |
| `npm run check:copy` | Comprueba el flujo de búsqueda y copia contra un Jira, GitLab y GitHub simulados (51 aserciones) |
| `npm run check:renderer` | Comprueba la parte de GitLab y GitHub de la modal de copia con el `renderer.js` real y un DOM simulado (27 aserciones) |
| `npm run check:search` | Comprueba el combo de búsqueda de Jira con el `renderer.js` real y un reloj simulado (10 aserciones) |
| `npm run check:bugs` | Comprueba la captura, el almacenamiento local y la bandeja de incidencias con los stubs headless (45 aserciones) |
| `npm run check:rename` | Comprueba que el renombrado conserva la configuración, las incidencias y las copias anteriores (7 aserciones) |
| `npm run serve:dist` | Sirve `dist/` por HTTP para el actualizador. Usa `PORT` (por defecto 8080) |
| `npx electron scripts/make-icon.js` | Regenera `assets/icon.png` y `assets/icon.ico` desde `assets/destajo.svg` |

## Generar el instalador

`npm run dist` genera en `dist/` el instalador `desTajo Setup <versión>.exe` (NSIS, asistido y por usuario) y la versión portable `desTajo <versión>.exe`. Antes de compilarlo, actualiza `version` en `package.json` y `package-lock.json`.

Al subir esos archivos a una release de GitHub, la plataforma reemplaza los espacios del nombre por puntos: `desTajo Setup <versión>.exe` pasa a ser `desTajo.Setup.<versión>.exe`. Enlázalos ya con ese nombre.

En Windows hay **un requisito del sistema**: al preparar sus herramientas, electron-builder extrae un archivador que contiene enlaces simbólicos. Si tu usuario no tiene privilegio para crearlos, el build falla siempre con:

```text
ERROR: Cannot create symbolic link : El cliente no dispone de un privilegio requerido
```

Aplica **una** de las dos opciones y vuelve a lanzar `npm run dist` (no hace falta limpiar nada):

1. Activar el **Modo de Desarrollador** (una vez): Ajustes → Sistema → Para desarrolladores → Modo de desarrollador. Seleccionarlo pide administrador.
2. O ejecutar la terminal **como Administrador** y lanzar `npm run dist` desde ahí.

Las descargas fallidas dejan restos en `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign`; son inofensivos y se sobrescriben en el siguiente intento.

## Actualizaciones automáticas

La app usa `electron-updater` con proveedor genérico. Para publicar una versión:

1. Sube la versión en `package.json`.
2. Ejecuta `npm run dist`.
3. Publica el contenido de `dist/` (incluido `latest.yml`) en la URL indicada en el campo **URL de actualizaciones** de la configuración.
4. Para probarlo en local, `npm run serve:dist` expone esa carpeta en `http://localhost:8080/`.

Si el campo queda vacío, se usa la URL de `build.publish` de `package.json`. La comprobación solo se ejecuta en la versión empaquetada.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `main.js` | Proceso principal: ventana, IPC, cliente de Jira, incidencias locales, notificaciones y actualizador |
| `preload.js` | Puente `window.api` entre el renderer y el proceso principal |
| `renderer/` | Interfaz: `index.html`, `renderer.js`, `styles.css` |
| `renderer/capture/` | Ventana de captura de incidencias, con su propio `capture-preload.js` |
| `assets/` | Iconos y el SVG de origen |
| `scripts/` | Servidor de actualizaciones e generador de iconos |

## Limitaciones conocidas

- No hay framework de tests ni linter. Los scripts `check:adf`, `check:copy`, `check:renderer`, `check:search`, `check:bugs` y `check:rename` son regresiones headless con Node y `assert`; el resto se verifica a mano ejecutando la app.
- El atajo global, la bandeja y el arranque con Windows los gestiona el sistema operativo: su lógica está cubierta por `check:bugs`, pero el comportamiento real (otra app en foco, el icono en el reloj) se comprueba a mano.
- Las incidencias son locales a cada equipo, en `bugs/<identificador>/`: no se sincronizan, no se suben a ningún sitio y la app no crea tareas en Jira.
- Jira Cloud no expone un feed de notificaciones fiable, así que la app escanea comentarios: hasta 100 issues y 10 páginas de comentarios por issue.
- El estado de lectura es local a cada equipo; no se sincroniza con Jira ni entre instalaciones.
- La app está pensada para una sola cuenta de Jira por equipo.

## Documentación para agentes

- `AGENTS.md`: contrato corto y portable para cualquier agente.
- `.opencode/instructions.md`: mapa de arquitectura, contrato IPC y trampas conocidas. Se carga mediante `opencode.json`; reinicia OpenCode después de modificarlo.

## Licencia

MIT.
