# NotiJira

Aplicación de escritorio para Windows que vigila Jira y te avisa cuando te mencionan en un comentario. Todo corre en local: sin servidor propio, sin telemetría y sin cuentas adicionales.

## Ruta rápida

1. `npm install`
2. `npm start`
3. Pulsa **Configuracion** e introduce la URL de tu Jira, tu email y tu API token.
4. Pulsa **Probar conexion** y después **Guardar**.

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

El token se guarda en texto plano en `config.json` dentro de la carpeta de datos de usuario de la aplicación. No se registra en logs ni se envía a ningún sitio que no sea tu propio Jira.

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
| Actualizaciones | Comprobación automática cada 6 horas en la versión empaquetada |

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm start` | Abre la app en modo desarrollo |
| `npm run pack` | Genera la app sin instalador en `dist/` |
| `npm run dist` | Genera el instalador NSIS y la versión portable en `dist/` |
| `npm run check:adf` | Comprueba el conversor ADF→Markdown (13 aserciones) |
| `npm run check:copy` | Comprueba el flujo de búsqueda y copia contra un Jira simulado (13 aserciones) |
| `npm run serve:dist` | Sirve `dist/` por HTTP para el actualizador. Usa `PORT` (por defecto 8080) |
| `npx electron scripts/make-icon.js` | Regenera `assets/icon.png` y `assets/icon.ico` desde `assets/jira.svg` |

## Generar el instalador

`npm run dist` genera en `dist/` el instalador `NotiJira Setup <versión>.exe` (NSIS, asistido y por usuario) y la versión portable `NotiJira <versión>.exe`. Antes de compilarlo, sube la `version` de `package.json` si quieres que el nombre lleve la nueva.

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
| `main.js` | Proceso principal: ventana, IPC, cliente de Jira, notificaciones y actualizador |
| `preload.js` | Puente `window.api` entre el renderer y el proceso principal |
| `renderer/` | Interfaz: `index.html`, `renderer.js`, `styles.css` |
| `assets/` | Iconos y el SVG de origen |
| `scripts/` | Servidor de actualizaciones e generador de iconos |

## Limitaciones conocidas

- No hay tests automatizados ni linter; la verificación es manual ejecutando la app.
- Jira Cloud no expone un feed de notificaciones fiable, así que la app escanea comentarios: hasta 100 issues y 10 páginas de comentarios por issue.
- El estado de lectura es local a cada equipo; no se sincroniza con Jira ni entre instalaciones.
- La app está pensada para una sola cuenta de Jira por equipo.

## Documentación para agentes

- `AGENTS.md`: contrato corto y portable para cualquier agente.
- `.opencode/instructions.md`: mapa de arquitectura, contrato IPC y trampas conocidas. Se carga mediante `opencode.json`; reinicia OpenCode después de modificarlo.

## Licencia

MIT.
