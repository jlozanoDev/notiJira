const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Notification,
  clipboard,
  globalShortcut,
  Tray,
  Menu,
  screen,
  nativeImage,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { adfToMarkdown, collectMedia } = require('./adf');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// El renombrado de NotiJira a desTajo cambia la carpeta de datos de usuario,
// porque Electron la deriva del nombre de la app. Se copia una sola vez lo que
// el usuario ya tenia (configuracion, incidencias y copias) para no perderlo.
// Nunca se mueve ni se sobrescribe: si la carpeta nueva ya tiene configuracion,
// la migracion no hace nada.
function migrateLegacyUserData() {
  const target = app.getPath('userData');
  const marker = path.join(target, '.renamed-from-notijira');
  try {
    if (fs.existsSync(path.join(target, 'config.json')) || fs.existsSync(marker)) {
      return;
    }

    const appData = app.getPath('appData');
    const entries = ['config.json', 'bugs', 'copied'];

    for (const legacyName of ['NotiJira', 'notijira']) {
      const source = path.join(appData, legacyName);
      if (source === target || !fs.existsSync(source)) continue;

      let copied = false;
      fs.mkdirSync(target, { recursive: true });
      for (const entry of entries) {
        const from = path.join(source, entry);
        if (!fs.existsSync(from)) continue;
        fs.cpSync(from, path.join(target, entry), {
          recursive: true,
          force: false,
          errorOnExist: false,
        });
        copied = true;
      }
      if (!copied) continue;

      fs.writeFileSync(marker, legacyName, 'utf-8');
      return;
    }
  } catch (err) {
    // Un fallo aqui no debe impedir el arranque: la app empieza sin datos previos.
    console.error('No se pudo migrar la configuracion anterior:', err.message);
  }
}

migrateLegacyUserData();

let mainWindow;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}

function normalizeBaseUrl(url) {
  if (!url) return '';
  let base = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    base = 'https://' + base;
  }
  return base;
}

function normalizeGitLabBaseUrl(url) {
  const base = normalizeBaseUrl(url);
  if (!base) return '';

  let parsed;
  try {
    parsed = new URL(base);
  } catch (err) {
    throw new Error('La URL de GitLab no es valida');
  }
  const hostname = (parsed.hostname || '').replace(/^\[|\]$/g, '');
  const ipLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const domainName = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(hostname);
  const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (!hostname || (!ipLiteral && !domainName && !localHost)) {
    throw new Error('La URL de GitLab no es valida');
  }
  if (
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHost))
  ) {
    throw new Error('La URL de GitLab debe usar HTTPS y no incluir credenciales');
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

async function gitlabRequest(config, endpoint) {
  const base = normalizeGitLabBaseUrl(config && config.gitlabUrl);
  const token = String((config && config.gitlabToken) || '').trim();
  if (!base) throw new Error('Falta la URL de GitLab');
  if (!token) throw new Error('Falta el token de GitLab');

  let response;
  try {
    response = await fetch(`${base}/api/v4${endpoint}`, {
      headers: {
        'PRIVATE-TOKEN': token,
        Accept: 'application/json',
      },
      redirect: 'error',
    });
  } catch (err) {
    // Un redirect rechazado o un fallo de TLS/red llegan aqui: no se revela el token.
    throw new Error('No se pudo conectar con GitLab; revisa la URL y la conexion');
  }
  if (!response.ok) {
    const error = new Error(
      `GitLab respondio ${response.status}. Comprueba la URL, el token y los permisos.`
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// GitLab filtra en el servidor con `search`; se pide una sola pagina de 100 y
// se avisa cuando viene llena para que el usuario concrete el texto.
const GITLAB_PAGE_SIZE = 100;

async function searchGitLabPage(config, endpoint, search) {
  const params = new URLSearchParams({
    per_page: String(GITLAB_PAGE_SIZE),
    page: '1',
  });
  const term = String(search || '').trim();
  if (term) params.set('search', term);

  const batch = await gitlabRequest(config, `${endpoint}?${params.toString()}`);
  if (!Array.isArray(batch)) throw new Error('GitLab devolvio una respuesta no valida');
  return { items: batch, truncated: batch.length >= GITLAB_PAGE_SIZE };
}

async function getGitLabProjects(config, search) {
  const { items, truncated } = await searchGitLabPage(config, '/projects', search);
  return {
    truncated,
    projects: items.map((project) => ({
      id: project.id,
      name: project.name || '',
      pathWithNamespace: project.path_with_namespace || project.name || '',
      webUrl: project.web_url || '',
    })),
  };
}

async function getGitLabBranches(config, projectId, search) {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('Selecciona un proyecto de GitLab');
  const { items, truncated } = await searchGitLabPage(
    config,
    `/projects/${encodeURIComponent(id)}/repository/branches`,
    search
  );
  return {
    truncated,
    branches: items.map((branch) => ({ name: branch.name || '' })).filter((branch) => branch.name),
  };
}

async function compareGitLabBranches(config, selection) {
  const projectId = String((selection && selection.projectId) || '').trim();
  const sourceBranch = String((selection && selection.sourceBranch) || '').trim();
  const targetBranch = String((selection && selection.targetBranch) || '').trim();
  if (!projectId || !sourceBranch || !targetBranch) {
    throw new Error('Selecciona el proyecto y las ramas de origen y destino');
  }

  const params = new URLSearchParams({
    from: targetBranch,
    to: sourceBranch,
  });
  const comparison = await gitlabRequest(
    config,
    `/projects/${encodeURIComponent(projectId)}/repository/compare?${params.toString()}`
  );
  if (comparison.compare_timeout) {
    throw new Error('GitLab no pudo completar la comparacion entre las ramas');
  }
  if (comparison.overflow) {
    throw new Error('El diff entre las ramas es demasiado grande para GitLab; reduce el rango de commits');
  }
  if ((comparison.diffs || []).some((file) => file.too_large || file.collapsed)) {
    throw new Error('GitLab no devolvio el diff completo de todos los archivos');
  }
  return comparison;
}

function formatGitLabDiff(comparison, selection) {
  const escapeTitle = (value) =>
    String(value || '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()#+.!|>]/g, '\\$&');
  const projectName = escapeTitle(selection.projectName || selection.projectId);
  const sourceBranch = escapeTitle(selection.sourceBranch);
  const targetBranch = escapeTitle(selection.targetBranch);
  const title =
    `## Diff de MR — ${projectName} · ${sourceBranch} → ${targetBranch}`;
  const files = Array.isArray(comparison.diffs) ? comparison.diffs : [];
  if (!files.length) return [title, 'No hay diferencias entre las ramas seleccionadas.'].join('\n\n');

  const diff = files.map((file) => {
    const oldPath = file.old_path || file.new_path || '';
    const newPath = file.new_path || file.old_path || '';
    const content = String(file.diff || '');
    if (/^diff --git /m.test(content)) return content;
    return [
      `diff --git a/${oldPath} b/${newPath}`,
      `--- ${file.new_file ? '/dev/null' : `a/${oldPath}`}`,
      `+++ ${file.deleted_file ? '/dev/null' : `b/${newPath}`}`,
      content,
    ].join('\n');
  }).join('\n');
  const backtickRuns = diff.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...backtickRuns.map((run) => run.length + 1)));
  return [title, `${fence}diff\n${diff}\n${fence}`].join('\n\n');
}

function buildAuthHeader(config) {
  const email = (config.email || '').trim();
  const token = (config.apiToken || '').trim();
  if (email) {
    const basic = Buffer.from(`${email}:${token}`).toString('base64');
    return `Basic ${basic}`;
  }
  return `Bearer ${token}`;
}

async function jiraRequest(config, endpoint, options = {}) {
  const base = normalizeBaseUrl(config.baseUrl);
  if (!base) throw new Error('Falta la URL de Jira');
  if (!config.apiToken) throw new Error('Falta el API token');

  const url = `${base}${endpoint}`;
  const headers = {
    Authorization: buildAuthHeader(config),
    Accept: 'application/json',
  };
  if (options.body) headers['Content-Type'] = 'application/json';

  const maxAttempts = options.retries === undefined ? 2 : options.retries;
  let response;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status !== 429 || attempt === maxAttempts) break;

    const retryAfter = Number(response.headers.get('retry-after')) || 2;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(retryAfter, 30) * 1000)
    );
  }

  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try {
      const json = JSON.parse(body);
      detail =
        json.errorMessages?.join(', ') ||
        json.message ||
        json.detail ||
        body;
    } catch (e) {
      /* ignorar */
    }
    const error = new Error(
      `Jira respondio ${response.status}: ${String(detail).slice(0, 300)}`
    );
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function getMyself(config) {
  for (const endpoint of ['/rest/api/3/myself', '/rest/api/2/myself']) {
    try {
      return await jiraRequest(config, endpoint);
    } catch (err) {
      /* probar el siguiente endpoint */
    }
  }
  return null;
}

function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('');
  let text = '';
  if (node.type === 'text' && typeof node.text === 'string') text += node.text;
  if (node.type === 'mention') {
    text += (node.attrs && (node.attrs.text || node.attrs.displayName)) || '';
  }
  if (node.type === 'hardBreak') text += '\n';
  if (Array.isArray(node.content)) {
    text += node.content.map(adfToText).join('');
  }
  return text;
}

function collectAdfMentions(node, me, found) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'mention') {
    const attrs = node.attrs || {};
    const id = attrs.id || attrs.accountId || '';
    const text = (attrs.text || '').replace(/^@/, '').trim();
    const display = (me.displayName || '').trim();
    const accountId = me.accountId || '';
    if (
      (accountId && id === accountId) ||
      (text && display && text.toLowerCase() === display.toLowerCase())
    ) {
      found.push(text || display);
    }
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectAdfMentions(child, me, found));
  }
}

function bodyMentionsUser(body, me) {
  if (!body) return false;

  if (typeof body === 'object') {
    const found = [];
    collectAdfMentions(body, me, found);
    return found.length > 0;
  }

  if (typeof body !== 'string') return false;

  const lower = body.toLowerCase();
  const accountId = (me.accountId || '').toLowerCase();
  if (accountId && lower.includes(`accountid:${accountId}`)) return true;
  if (accountId && lower.includes(accountId)) return true;

  const identifiers = [
    me.name,
    me.key,
    me.emailAddress,
    (me.displayName || '').replace(/\s+/g, ''),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  for (const id of identifiers) {
    if (lower.includes(`[~${id}]`)) return true;
    if (lower.includes(`@${id}`)) return true;
  }

  const display = (me.displayName || '').trim().toLowerCase();
  if (display && lower.includes('@' + display)) return true;

  return false;
}

function cleanCommentText(text) {
  return String(text || '')
    .replace(/\[~accountid:[^\]]+\]/gi, '')
    .replace(/\[~[^\]]+\]/g, '')
    .replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function commentText(body) {
  if (!body) return '';
  if (typeof body === 'string') return cleanCommentText(body);
  return cleanCommentText(adfToText(body));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }

  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

async function searchIssues(config, jql, fields, maxResults = 100) {
  try {
    return await jiraRequest(config, '/rest/api/3/search/jql', {
      method: 'POST',
      body: {
        jql,
        maxResults,
        fields,
      },
    });
  } catch (err) {
    if (err.status !== 404 && err.status !== 410) throw err;

    const params = new URLSearchParams({
      jql,
      maxResults: String(maxResults),
      fields: fields.join(','),
    });
    return jiraRequest(config, `/rest/api/2/search?${params.toString()}`);
  }
}

async function fetchAllComments(config, issueKey) {
  const comments = [];
  const maxResults = 100;
  let startAt = 0;

  for (let page = 0; page < 10; page++) {
    const data = await jiraRequest(
      config,
      `/rest/api/2/issue/${issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}`
    );
    const batch = data.comments || [];
    comments.push(...batch);

    const total = typeof data.total === 'number' ? data.total : comments.length;
    if (batch.length === 0 || comments.length >= total) break;
    startAt += batch.length;
  }

  return comments;
}

async function fetchMentions(config) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const me = await getMyself(config);
  if (!me) throw new Error('No se pudo obtener el usuario actual de Jira');

  const fields = [
    'summary',
    'status',
    'priority',
    'issuetype',
    'project',
    'reporter',
    'updated',
  ];
  const jql = 'comment ~ currentUser() AND updated >= -90d ORDER BY updated DESC';

  let search;
  try {
    search = await searchIssues(config, jql, fields);
  } catch (err) {
    if (err.status !== 400 || !me.accountId) throw err;
    const fallbackJql = `comment ~ "${me.accountId}" AND updated >= -90d ORDER BY updated DESC`;
    search = await searchIssues(config, fallbackJql, fields);
  }
  const issues = search.issues || [];

  const perIssue = await mapLimit(issues, 4, async (issue) => {
    let list;
    try {
      list = await fetchAllComments(config, issue.key);
    } catch (err) {
      return [];
    }

    const matches = [];

    for (const comment of list) {
      if (!bodyMentionsUser(comment.body, me)) continue;

      const author = comment.author?.displayName || '';
      const created = comment.created || '';
      const createdTs = created ? new Date(created).getTime() : 0;
      const isFresh = createdTs && Date.now() - createdTs <= 24 * 60 * 60 * 1000;

      matches.push({
        id: `${issue.id || issue.key}:${comment.id}`,
        subject: `${issue.key} · ${issue.fields?.summary || 'Sin titulo'}`,
        issueKey: issue.key,
        textBody: `${author ? author + ' te menciono: ' : 'Te mencionaron: '}${commentText(
          comment.body
        ).slice(0, 300)}`,
        author: author ? { displayName: author } : null,
        created: created || issue.fields?.updated || null,
        reason: 'mencion',
        read: !isFresh,
        webUrl: `${baseUrl}/browse/${issue.key}?focusedCommentId=${comment.id}`,
      });
    }

    if (matches.length === 0) {
      const updated = issue.fields?.updated || null;
      const updatedTs = updated ? new Date(updated).getTime() : 0;
      const isFresh = updatedTs && Date.now() - updatedTs <= 24 * 60 * 60 * 1000;

      matches.push({
        id: `${issue.id || issue.key}:mention`,
        subject: `${issue.key} · ${issue.fields?.summary || 'Sin titulo'}`,
        issueKey: issue.key,
        textBody: 'Te mencionaron en un comentario de este issue.',
        author: null,
        created: updated,
        reason: 'mencion',
        read: !isFresh,
        webUrl: `${baseUrl}/browse/${issue.key}`,
      });
    }

    return matches;
  });

  const flat = perIssue.flat();
  flat.sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  );
  return flat;
}

async function fetchNotifications(config) {
  try {
    const data = await jiraRequest(
      config,
      '/rest/api/3/notifications?maxResults=100'
    );
    const items = data.notifications || data.values;
    if (Array.isArray(items)) {
      const mentions = items.filter((item) =>
        /mention/i.test(item.reason || item.type || '')
      );
      if (mentions.length) return mentions;
    }
  } catch (err) {
    /* Jira no expone el feed de notificaciones, se usa el escaneo de menciones */
  }

  return fetchMentions(config);
}

// ---------------------------------------------------------------------------
// Busqueda y copia de tareas (utilidad "copiar para OpenCode")
// ---------------------------------------------------------------------------

// Pestañas reales de la instancia, verificadas contra /rest/api/3/field.
// "Gestion" no existe como campo y se omite a peticion del usuario.
const COPY_TAB_FIELDS = [
  { id: 'customfield_10090', label: 'Entrada', kind: 'datetime' },
  { id: 'customfield_10218', label: 'PreAnálisis', kind: 'adf' },
  { id: 'customfield_10253', label: 'Contexto', kind: 'adf' },
  { id: 'customfield_10250', label: 'Análisis Funcional', kind: 'adf' },
  { id: 'customfield_10450', label: 'Casos de Prueba', kind: 'adf' },
  { id: 'customfield_10448', label: 'Desglose Funcional', kind: 'adf' },
  { id: 'customfield_10251', label: 'Análisis Técnico', kind: 'adf' },
  { id: 'customfield_10481', label: 'QA', kind: 'adf' },
];

function escapeJqlText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function searchResult(issue, baseUrl) {
  const fields = issue.fields || {};
  return {
    key: issue.key,
    summary: fields.summary || 'Sin titulo',
    status: (fields.status && fields.status.name) || '',
    issuetype: (fields.issuetype && fields.issuetype.name) || '',
    updated: fields.updated || null,
    webUrl: `${baseUrl}/browse/${issue.key}`,
  };
}

const SEARCH_RESULT_FIELDS = ['summary', 'status', 'issuetype', 'updated'];
const SEARCH_RESULT_LIMIT = 20;
const ISSUE_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;

function parseIssueKey(text) {
  const match = String(text || '').trim().match(ISSUE_KEY_PATTERN);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : '';
}

async function searchIssuesForCopy(config, query) {
  const text = String(query || '').trim();
  if (!text) throw new Error('Escribe una clave de tarea o una descripcion');
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const issueKey = parseIssueKey(text);

  // Una clave completa abre la tarea directamente (una sola peticion) y evita el
  // 400 que devuelve JQL cuando la clave no existe. Se prueban v3 y v2 porque
  // Jira Server/Data Center solo expone v2.
  if (issueKey) {
    for (const version of ['3', '2']) {
      try {
        const issue = await jiraRequest(
          config,
          `/rest/api/${version}/issue/${issueKey}?fields=${SEARCH_RESULT_FIELDS.join(',')}`
        );
        return { results: [searchResult(issue, baseUrl)] };
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
  }

  // `text` cubre resumen, descripcion, entorno y comentarios de la tarea.
  const jql = `text ~ "${escapeJqlText(text)}" ORDER BY updated DESC`;
  const search = await searchIssues(
    config,
    jql,
    SEARCH_RESULT_FIELDS,
    SEARCH_RESULT_LIMIT
  );
  const results = (search.issues || []).map((issue) => searchResult(issue, baseUrl));

  return {
    results,
    error:
      issueKey && !results.length
        ? `La tarea ${issueKey} no existe; se busca por texto.`
        : undefined,
  };
}

async function fetchIssueComments(config, issueKey) {
  const comments = [];
  let startAt = 0;

  for (let page = 0; page < 20; page++) {
    const data = await jiraRequest(
      config,
      `/rest/api/3/issue/${issueKey}/comment?startAt=${startAt}&maxResults=100`
    );
    const batch = data.comments || [];
    comments.push(...batch);

    const total = typeof data.total === 'number' ? data.total : comments.length;
    if (batch.length === 0 || comments.length >= total) break;
    startAt += batch.length;
  }

  return comments;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function previewText(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = typeof value === 'string' ? value : adfToText(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function fetchIssueCopyRaw(config, issueKey) {
  const key = String(issueKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error('Clave de tarea no valida');

  const fieldList = COPY_TAB_FIELDS.map((tab) => tab.id).join(',');
  const issue = await jiraRequest(
    config,
    `/rest/api/3/issue/${key}?fields=summary,status,issuetype,attachment,${fieldList}`
  );
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fields = issue.fields || {};
  const comments = await fetchIssueComments(config, key);

  return {
    issue: {
      key,
      summary: fields.summary || 'Sin titulo',
      url: `${baseUrl}/browse/${key}`,
    },
    values: Object.fromEntries(
      COPY_TAB_FIELDS.map((tab) => [tab.id, fields[tab.id] ?? null])
    ),
    comments,
    attachments: (fields.attachment || []).map((item) => ({
      id: String(item.id),
      filename: item.filename || `adjunto-${item.id}`,
      size: item.size || 0,
      url: item.content || '',
    })),
    baseUrl,
  };
}

function copyDataPreview(raw) {
  return {
    issue: raw.issue,
    sections: COPY_TAB_FIELDS.map((tab) => {
      const value = raw.values[tab.id];
      return {
        id: tab.id,
        label: tab.label,
        kind: tab.kind,
        empty: value === null || value === undefined || value === '',
        preview:
          tab.kind === 'datetime' ? formatDateTime(value) : previewText(value),
      };
    }),
    comments: raw.comments.map((comment) => ({
      id: String(comment.id),
      author: (comment.author && comment.author.displayName) || '',
      created: comment.created || '',
      preview: previewText(comment.body),
    })),
    attachments: raw.attachments.map((item) => ({
      filename: item.filename,
      size: item.size,
    })),
  };
}

// La modal consulta los datos y el botón de copiar los reutiliza sin repetir
// peticiones; una sola entrada en caché, válida 10 minutos.
let copyCache = { key: '', at: 0, raw: null };

async function getCachedCopyRaw(config, issueKey) {
  const key = String(issueKey || '').trim().toUpperCase();
  lastIssueKey = /^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? key : lastIssueKey;
  const fresh =
    copyCache.raw &&
    copyCache.key === key &&
    Date.now() - copyCache.at < 10 * 60 * 1000;
  if (fresh) return copyCache.raw;

  const raw = await fetchIssueCopyRaw(config, key);
  copyCache = { key, at: Date.now(), raw };
  return raw;
}

async function jiraFetchBytes(config, endpoint) {
  const base = normalizeBaseUrl(config.baseUrl);
  if (!base) throw new Error('Falta la URL de Jira');
  if (!config.apiToken) throw new Error('Falta el API token');

  const response = await fetch(`${base}${endpoint}`, {
    headers: { Authorization: buildAuthHeader(config), Accept: '*/*' },
  });
  if (!response.ok) {
    throw new Error(`Jira respondio ${response.status} al descargar`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function safeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim();
  return cleaned || 'archivo';
}

async function downloadAsset(config, raw, id, dir, usedNames) {
  const attachment = raw.attachments.find((item) => item.id === String(id));
  const hint = attachment ? attachment.filename : '';
  const endpoints = [`/rest/api/3/attachment/content/${id}?redirect=false`];
  if (hint) {
    endpoints.push(`/secure/attachment/${id}/${encodeURIComponent(hint)}`);
  }

  let bytes = null;
  for (const endpoint of endpoints) {
    try {
      bytes = await jiraFetchBytes(config, endpoint);
      break;
    } catch (err) {
      // se prueba el siguiente endpoint
    }
  }
  if (!bytes) return null;

  let name = safeFilename(hint || `adjunto-${id}`);
  if (usedNames.has(name)) name = `${id}-${name}`;
  usedNames.add(name);

  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, bytes);
  return dest;
}

async function copyIssueToClipboard(config, issueKey, selection) {
  const raw = await getCachedCopyRaw(config, issueKey);
  const gitlabSelection = selection.gitlab || {};
  const wantedSections = new Set(
    Array.isArray(selection.sections) ? selection.sections : []
  );
  const wantedComments = new Set(
    Array.isArray(selection.comments) ? selection.comments.map(String) : []
  );

  const sections = COPY_TAB_FIELDS.filter((tab) => {
    if (!wantedSections.has(tab.id)) return false;
    const value = raw.values[tab.id];
    return value !== null && value !== undefined && value !== '';
  });
  const comments = raw.comments.filter((comment) =>
    wantedComments.has(String(comment.id))
  );

  if (!sections.length && !comments.length) {
    throw new Error('No has seleccionado nada para copiar');
  }
  const gitlabComparison = selection.includeMr
    ? await compareGitLabBranches(config, gitlabSelection)
    : null;

  // Descarga: todos los adjuntos de la tarea (S3) + los medios inline que
  // aparezcan dentro del contenido seleccionado.
  const media = { mediaIds: [], attachmentIds: [] };
  sections.forEach((tab) => {
    if (raw.values[tab.id] && typeof raw.values[tab.id] === 'object') {
      collectMedia(raw.values[tab.id], media);
    }
  });
  comments.forEach((comment) => collectMedia(comment.body, media));

  const wantedIds = new Set([
    ...raw.attachments.map((item) => item.id),
    ...media.mediaIds,
    ...media.attachmentIds,
  ]);

  const dir = path.join(app.getPath('userData'), 'copied', raw.issue.key);
  const localPaths = new Map();
  const usedNames = new Set();
  let failed = 0;

  await mapLimit([...wantedIds], 4, async (id) => {
    try {
      const dest = await downloadAsset(config, raw, id, dir, usedNames);
      if (dest) localPaths.set(String(id), dest);
      else failed += 1;
    } catch (err) {
      failed += 1;
    }
  });

  const resolveMedia = (id) => {
    const local = localPaths.get(String(id));
    if (local) return local.split(path.sep).join('/');
    const attachment = raw.attachments.find((item) => item.id === String(id));
    return attachment && attachment.url ? attachment.url : '';
  };

  const blocks = [];
  blocks.push(`# ${raw.issue.key} — ${raw.issue.summary}`);
  blocks.push(raw.issue.url);

  for (const tab of sections) {
    const value = raw.values[tab.id];
    let body = '';
    if (tab.kind === 'datetime') body = formatDateTime(value);
    else if (typeof value === 'string') body = value.trim();
    else body = adfToMarkdown(value, { resolveMedia });
    if (body) blocks.push(`## ${tab.label}`, body);
  }

  if (comments.length) {
    blocks.push('## Comentarios');
    for (const comment of comments) {
      const author = (comment.author && comment.author.displayName) || 'Sin autor';
      blocks.push(`### ${author} · ${formatDateTime(comment.created)}`);
      blocks.push(adfToMarkdown(comment.body, { resolveMedia }));
    }
  }

  if (raw.attachments.length) {
    blocks.push('## Adjuntos');
    for (const item of raw.attachments) {
      const target = resolveMedia(item.id);
      blocks.push(target ? `- [${item.filename}](<${target}>)` : `- ${item.filename}`);
    }
  }
  if (gitlabComparison) {
    blocks.push(formatGitLabDiff(gitlabComparison, gitlabSelection));
  }

  const markdown = blocks.filter((block) => block !== '').join('\n\n');
  clipboard.writeText(markdown);

  return {
    sections: sections.length,
    comments: comments.length,
    attachments: raw.attachments.length,
    downloaded: localPaths.size,
    failed,
    chars: markdown.length,
    folder: wantedIds.size ? dir : '',
  };
}

// ---------------------------------------------------------------------------
// Bandeja de incidencias (captura rapida)
// ---------------------------------------------------------------------------

const DEFAULT_BUG_HOTKEY = 'Control+Alt+J';
const BUG_STATES = ['new', 'created', 'archived'];
const MAX_BUG_IMAGES = 20;
const MAX_BUG_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BUG_TITLE = 300;
const MAX_BUG_DETAILS = 20000;
const MAX_BUG_LINKS = 10;
const BUG_ID_PATTERN = /^b-\d{14}-[0-9a-f]{4}$/;
const BUG_IMAGE_PATTERN = /^img-\d+\.(png|jpg|gif|webp)$/;
const IMAGE_EXTENSION_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const IMAGE_MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

let captureWindow = null;
let tray = null;
let isQuitting = false;
let activeBugHotkey = '';
let lastIssueKey = '';

function bugsRoot() {
  return path.join(app.getPath('userData'), 'bugs');
}

function bugDir(id) {
  return path.join(bugsRoot(), id);
}

function bugNotePath(id) {
  return path.join(bugDir(id), 'nota.json');
}

function bugDraftPath() {
  return path.join(bugsRoot(), '.draft.json');
}

function newBugId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return `b-${stamp}-${suffix}`;
}

// Un enlace se etiqueta por su origen: el usuario captura lo mismo desde el
// navegador, Slack o un comentario de Jira.
function classifyLink(url) {
  const text = String(url || '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) return { url: text, kind: 'otro' };
  if (/\.slack\.com\/archives\//i.test(text)) return { url: text, kind: 'slack' };
  if (/\/browse\/[A-Za-z][A-Za-z0-9_]*-\d+/i.test(text)) return { url: text, kind: 'jira' };
  return { url: text, kind: 'web' };
}

function issueKeyFromText(text) {
  const direct = parseIssueKey(text);
  if (direct) return direct;
  const match = String(text || '').match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/i);
  return match ? parseIssueKey(match[1]) : '';
}

function normalizeBugLinks(links) {
  if (!Array.isArray(links)) return [];
  const normalized = [];
  for (const link of links.slice(0, MAX_BUG_LINKS)) {
    const parsed = classifyLink(typeof link === 'string' ? link : link && link.url);
    if (!parsed) continue;
    if (normalized.some((item) => item.url === parsed.url)) continue;
    normalized.push(parsed);
  }
  return normalized;
}

function normalizeBugNote(raw, trustedId) {
  const note = raw && typeof raw === 'object' ? raw : {};
  const createdAt =
    typeof note.createdAt === 'string' && note.createdAt
      ? note.createdAt
      : new Date().toISOString();
  return {
    // El identificador lo define la carpeta, nunca lo que dice el JSON guardado:
    // un nota.json editado no puede redirigir la escritura a otra ruta.
    id: String(
      trustedId || (BUG_ID_PATTERN.test(String(note.id || '')) ? note.id : '')
    ),
    title: String(note.title || '').slice(0, MAX_BUG_TITLE),
    details: String(note.details || '').slice(0, MAX_BUG_DETAILS),
    links: normalizeBugLinks(note.links),
    issueKey: issueKeyFromText(note.issueKey || ''),
    images: Array.isArray(note.images)
      ? note.images.filter((name) => BUG_IMAGE_PATTERN.test(String(name)))
      : [],
    state: BUG_STATES.includes(note.state) ? note.state : 'new',
    jiraKey: issueKeyFromText(note.jiraKey || ''),
    createdAt,
    updatedAt:
      typeof note.updatedAt === 'string' && note.updatedAt ? note.updatedAt : createdAt,
    createdJiraAt:
      typeof note.createdJiraAt === 'string' && note.createdJiraAt ? note.createdJiraAt : null,
  };
}

function writeBugNote(note) {
  if (!BUG_ID_PATTERN.test(String((note && note.id) || ''))) {
    throw new Error('Incidencia no valida');
  }
  const dir = bugDir(note.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(bugNotePath(note.id), JSON.stringify(note, null, 2), 'utf-8');
}

function readBugNote(id) {
  if (!BUG_ID_PATTERN.test(String(id || ''))) throw new Error('Incidencia no valida');
  const raw = fs.readFileSync(bugNotePath(id), 'utf-8');
  return normalizeBugNote(JSON.parse(raw), id);
}

function listBugs() {
  let entries;
  try {
    entries = fs.readdirSync(bugsRoot(), { withFileTypes: true });
  } catch (err) {
    return [];
  }
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !BUG_ID_PATTERN.test(entry.name)) continue;
    try {
      items.push(readBugNote(entry.name));
    } catch (err) {
      /* una carpeta corrupta no invalida el resto */
    }
  }
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}

function saveBugImage(id, image, index) {
  const type = image && typeof image.type === 'string' ? image.type.toLowerCase() : '';
  const extension = IMAGE_EXTENSION_BY_TYPE[type];
  if (!extension) return '';
  let bytes = image && image.bytes;
  // El portapapeles y el selector de archivos llegan como ArrayBuffer: hay que
  // convertirlos antes de mirar la longitud (.length es undefined alli).
  if (bytes && !(bytes instanceof Uint8Array)) {
    try {
      bytes = new Uint8Array(bytes);
    } catch (err) {
      return '';
    }
  }
  if (!bytes || !bytes.length || bytes.length > MAX_BUG_IMAGE_BYTES) return '';
  const filename = `img-${index}.${extension}`;
  fs.mkdirSync(bugDir(id), { recursive: true });
  fs.writeFileSync(path.join(bugDir(id), filename), Buffer.from(bytes));
  return filename;
}

function addBugImage(id, image) {
  const note = readBugNote(id);
  if (note.images.length >= MAX_BUG_IMAGES) {
    throw new Error(`Cada incidencia admite como maximo ${MAX_BUG_IMAGES} imagenes`);
  }
  let index = note.images.length + 1;
  while (note.images.includes(`img-${index}.${IMAGE_EXTENSION_BY_TYPE[(image && image.type) || '']}`)) {
    index += 1;
  }
  const filename = saveBugImage(id, image, index);
  if (!filename) throw new Error('La imagen no es valida o supera los 10 MB');
  note.images.push(filename);
  note.updatedAt = new Date().toISOString();
  writeBugNote(note);
  return { note, filename };
}

function removeBugImage(id, filename) {
  if (!BUG_IMAGE_PATTERN.test(String(filename || ''))) throw new Error('Imagen no valida');
  const note = readBugNote(id);
  note.images = note.images.filter((item) => item !== filename);
  note.updatedAt = new Date().toISOString();
  writeBugNote(note);
  try {
    fs.unlinkSync(path.join(bugDir(id), filename));
  } catch (err) {
    /* el archivo ya no existia */
  }
  return note;
}

function readBugImageDataUrl(id, filename) {
  if (!BUG_ID_PATTERN.test(String(id || '')) || !BUG_IMAGE_PATTERN.test(String(filename || ''))) {
    throw new Error('Imagen no valida');
  }
  const extension = String(filename).split('.').pop();
  const mime = IMAGE_MIME_BY_EXTENSION[extension];
  if (!mime) throw new Error('Formato de imagen no soportado');
  const bytes = fs.readFileSync(path.join(bugDir(id), filename));
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function createBug(payload) {
  const input = payload || {};
  const title = String(input.title || '').trim();
  if (!title) throw new Error('El titulo de la incidencia es obligatorio');

  const now = new Date().toISOString();
  const id = newBugId();
  const note = normalizeBugNote(
    {
      id,
      title,
      details: input.details,
      links: input.links,
      issueKey: input.issueKey,
      state: 'new',
      createdAt: now,
      updatedAt: now,
    },
    id
  );

  fs.mkdirSync(bugDir(note.id), { recursive: true });
  let failed = 0;
  const images = Array.isArray(input.images) ? input.images.slice(0, MAX_BUG_IMAGES) : [];
  images.forEach((image, position) => {
    const filename = saveBugImage(note.id, image, position + 1);
    if (filename) note.images.push(filename);
    else failed += 1;
  });

  writeBugNote(note);
  return { note, failed };
}

function updateBug(id, changes) {
  const note = readBugNote(id);
  const patch = changes && typeof changes === 'object' ? changes : {};

  if (patch.title !== undefined) {
    const title = String(patch.title || '').trim();
    if (!title) throw new Error('El titulo de la incidencia es obligatorio');
    note.title = title.slice(0, MAX_BUG_TITLE);
  }
  if (patch.details !== undefined) {
    note.details = String(patch.details || '').slice(0, MAX_BUG_DETAILS);
  }
  if (patch.links !== undefined) note.links = normalizeBugLinks(patch.links);
  if (patch.issueKey !== undefined) note.issueKey = issueKeyFromText(patch.issueKey || '');

  if (patch.state !== undefined) {
    if (!BUG_STATES.includes(patch.state)) throw new Error('Estado no valido');
    if (patch.state === 'created') {
      const jiraKey = issueKeyFromText(patch.jiraKey !== undefined ? patch.jiraKey : note.jiraKey);
      if (!jiraKey) throw new Error('Escribe la clave de Jira, por ejemplo CLIN-530');
      note.jiraKey = jiraKey;
      note.state = 'created';
      note.createdJiraAt = new Date().toISOString();
    } else {
      note.state = patch.state;
      if (patch.state === 'new') {
        note.jiraKey = '';
        note.createdJiraAt = null;
      }
    }
  } else if (patch.jiraKey !== undefined) {
    note.jiraKey = issueKeyFromText(patch.jiraKey || '');
  }

  note.updatedAt = new Date().toISOString();
  writeBugNote(note);
  return note;
}

function deleteBug(id) {
  if (!BUG_ID_PATTERN.test(String(id || ''))) throw new Error('Incidencia no valida');
  fs.rmSync(bugDir(id), { recursive: true, force: true });
  return true;
}

function bugStateLabel(state) {
  if (state === 'created') return 'Creada';
  if (state === 'archived') return 'Archivada';
  return 'Nueva';
}

function bugLinkLabel(kind) {
  if (kind === 'slack') return 'Slack';
  if (kind === 'jira') return 'Jira';
  if (kind === 'web') return 'Web';
  return 'Enlace';
}

function bugImagePaths(note) {
  return note.images.map((filename) =>
    path.join(bugDir(note.id), filename).split(path.sep).join('/')
  );
}

function bugToMarkdown(note) {
  const normalized = normalizeBugNote(note);
  const title = normalized.title.replace(/[\r\n]+/g, ' ').trim() || 'Incidencia';
  const blocks = [`# ${title}`];

  const meta = [`- Capturada: ${formatDateTime(normalized.createdAt)}`];
  meta.push(`- Estado: ${bugStateLabel(normalized.state)}`);
  if (normalized.issueKey) meta.push(`- Issue relacionado: ${normalized.issueKey}`);
  if (normalized.jiraKey) {
    const when = normalized.createdJiraAt ? ` · ${formatDateTime(normalized.createdJiraAt)}` : '';
    meta.push(`- Creada en Jira: ${normalized.jiraKey}${when}`);
  }
  blocks.push(meta.join('\n'));

  if (normalized.details.trim()) blocks.push('## Detalles', normalized.details.trim());
  if (normalized.links.length) {
    blocks.push(
      '## Enlaces',
      normalized.links.map((link) => `- ${bugLinkLabel(link.kind)}: ${link.url}`).join('\n')
    );
  }
  if (normalized.images.length) {
    blocks.push(
      '## Imágenes',
      bugImagePaths(normalized)
        .map((file) => `- ${file}`)
        .join('\n')
    );
  }
  return blocks.join('\n\n');
}

function readBugDraft() {
  try {
    const raw = fs.readFileSync(bugDraftPath(), 'utf-8');
    const draft = JSON.parse(raw);
    return {
      title: String((draft && draft.title) || ''),
      details: String((draft && draft.details) || ''),
      links: normalizeBugLinks(draft && draft.links),
      issueKey: String((draft && draft.issueKey) || ''),
    };
  } catch (err) {
    return null;
  }
}

function saveBugDraft(draft) {
  if (!draft || typeof draft !== 'object') return false;
  const title = String(draft.title || '');
  const details = String(draft.details || '');
  const links = normalizeBugLinks(draft.links);
  const issueKey = String(draft.issueKey || '');
  if (!title.trim() && !details.trim() && !links.length && !issueKey.trim()) {
    clearBugDraft();
    return false;
  }
  fs.mkdirSync(bugsRoot(), { recursive: true });
  fs.writeFileSync(
    bugDraftPath(),
    JSON.stringify({ title, details, links, issueKey }, null, 2),
    'utf-8'
  );
  return true;
}

function clearBugDraft() {
  try {
    fs.rmSync(bugDraftPath(), { force: true });
  } catch (err) {
    /* sin borrador */
  }
}

function clipboardUrl() {
  try {
    const text = clipboard.readText().trim();
    if (!/^https?:\/\/\S+$/i.test(text)) return '';
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? text : '';
  } catch (err) {
    return '';
  }
}

function normalizeAccelerator(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parts = text.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const key = parts.pop();
  const modifiers = [];
  for (const part of parts) {
    const name = part.toLowerCase();
    const modifier = {
      ctrl: 'Control',
      control: 'Control',
      alt: 'Alt',
      shift: 'Shift',
      super: 'Super',
      meta: 'Super',
      cmd: 'Super',
      command: 'Super',
    }[name];
    if (!modifier || modifiers.includes(modifier)) return '';
    modifiers.push(modifier);
  }
  if (!/^[A-Za-z0-9]{1,10}$/.test(key)) return '';
  const normalizedKey = /^[A-Za-z]$/.test(key) ? key.toUpperCase() : key;
  return [...modifiers, normalizedKey].join('+');
}

function hotkeyLabel(accelerator) {
  return String(accelerator || '').replace('Control', 'Ctrl');
}

// El atajo anterior se conserva si el nuevo no se puede registrar: nunca se deja
// al usuario sin captura por un cambio fallido.
function applyBugShortcut(accelerator) {
  const target = normalizeAccelerator(accelerator) || DEFAULT_BUG_HOTKEY;
  if (!globalShortcut || typeof globalShortcut.register !== 'function') {
    activeBugHotkey = '';
    return { ok: true, accelerator: target };
  }
  if (
    activeBugHotkey === target &&
    typeof globalShortcut.isRegistered === 'function' &&
    globalShortcut.isRegistered(target)
  ) {
    return { ok: true, accelerator: target };
  }

  const previous = activeBugHotkey;
  if (previous) {
    try {
      globalShortcut.unregister(previous);
    } catch (err) {
      /* el atajo ya no estaba registrado */
    }
    activeBugHotkey = '';
  }

  let registered = false;
  try {
    registered = globalShortcut.register(target, () => showCaptureWindow());
  } catch (err) {
    registered = false;
  }

  if (registered) {
    activeBugHotkey = target;
    return { ok: true, accelerator: target };
  }

  if (previous) {
    try {
      if (globalShortcut.register(previous, () => showCaptureWindow())) {
        activeBugHotkey = previous;
      }
    } catch (err) {
      /* se queda sin atajo, la bandeja sigue disponible */
    }
  }
  return {
    ok: false,
    accelerator: activeBugHotkey,
    error: `No se pudo registrar ${hotkeyLabel(target)}; puede estar ocupado por otra aplicacion.`,
  };
}

function applyAutostart(enabled) {
  if (!app.isPackaged || typeof app.setLoginItemSettings !== 'function') return false;
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return true;
  } catch (err) {
    return false;
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showCaptureWindow() {
  if (!captureWindow || captureWindow.isDestroyed()) {
    captureWindow = new BrowserWindow({
      width: 520,
      height: 620,
      minWidth: 420,
      minHeight: 460,
      frame: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      show: false,
      title: 'Capturar incidencia',
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'renderer', 'capture', 'capture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    captureWindow.loadFile(path.join(__dirname, 'renderer', 'capture', 'index.html'));
    captureWindow.on('closed', () => {
      captureWindow = null;
    });
  }

  const wasVisible = captureWindow.isVisible();

  try {
    const point = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(point).workArea;
    const [width, height] = captureWindow.getSize();
    captureWindow.setPosition(
      Math.round(area.x + (area.width - width) / 2),
      Math.round(area.y + (area.height - height) / 3)
    );
  } catch (err) {
    /* sin informacion de pantalla, se deja la posicion por defecto */
  }

  captureWindow.show();
  captureWindow.focus();

  // Solo se reinicia el formulario al reabrir: pulsar el atajo con la ventana
  // ya visible no debe borrar lo que el usuario esta escribiendo.
  if (!wasVisible && captureWindow.webContents && !captureWindow.webContents.isLoading()) {
    captureWindow.webContents.send('capture:shown');
  }
}

function createTray() {
  if (!Tray || !nativeImage) return;
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
    tray = new Tray(icon);
  } catch (err) {
    tray = null;
    return;
  }
  tray.setToolTip('desTajo');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Capturar incidencia', click: () => showCaptureWindow() },
      { label: 'Abrir desTajo', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => showCaptureWindow());
}

ipcMain.handle('config:get', () => {
  const config = readConfig();
  if (!config) return null;
  return {
    baseUrl: config.baseUrl || '',
    email: config.email || '',
    apiToken: config.apiToken || '',
    updateUrl: config.updateUrl || '',
    gitlabUrl: config.gitlabUrl || '',
    gitlabToken: config.gitlabToken || '',
    bugHotkey: config.bugHotkey || DEFAULT_BUG_HOTKEY,
    bugStartAtLogin: config.bugStartAtLogin === true,
    bugShortcutActive: Boolean(
      activeBugHotkey &&
        globalShortcut &&
        typeof globalShortcut.isRegistered === 'function' &&
        globalShortcut.isRegistered(activeBugHotkey)
    ),
  };
});

ipcMain.handle('config:save', (_event, config) => {
  const incoming = config || {};
  let gitlabUrl;
  try {
    gitlabUrl = normalizeGitLabBaseUrl(incoming.gitlabUrl || '');
  } catch (err) {
    // Una URL invalida no debe descartar la configuracion de Jira ya guardada.
    return { ok: false, error: err.message };
  }

  // Otros flujos de guardado (por ejemplo las credenciales de GitLab) envian un
  // payload parcial: el atajo y el arranque se conservan cuando no vienen.
  const stored = readConfig() || {};
  const explicitHotkey =
    incoming.bugHotkey !== undefined && String(incoming.bugHotkey).trim()
      ? String(incoming.bugHotkey).trim()
      : '';
  const requestedHotkey = explicitHotkey || stored.bugHotkey || DEFAULT_BUG_HOTKEY;
  const bugHotkey =
    normalizeAccelerator(requestedHotkey) || (explicitHotkey ? '' : DEFAULT_BUG_HOTKEY);
  if (!bugHotkey) {
    return {
      ok: false,
      error: 'El atajo de captura no es valido: usa al menos un modificador y una tecla.',
    };
  }
  const bugStartAtLogin =
    incoming.bugStartAtLogin !== undefined
      ? incoming.bugStartAtLogin === true
      : stored.bugStartAtLogin === true;

  const hotkeyBefore = activeBugHotkey;
  let shortcut = null;
  try {
    shortcut = applyBugShortcut(bugHotkey);
    writeConfig({
      baseUrl: normalizeBaseUrl(incoming.baseUrl),
      email: (incoming.email || '').trim(),
      apiToken: (incoming.apiToken || '').trim(),
      updateUrl: (incoming.updateUrl || '').trim(),
      gitlabUrl,
      gitlabToken: gitlabUrl ? (incoming.gitlabToken || '').trim() : '',
      bugHotkey: shortcut.ok ? bugHotkey : activeBugHotkey || bugHotkey,
      bugStartAtLogin,
    });
    configureUpdater();
    applyAutostart(bugStartAtLogin);
    return shortcut.ok ? { ok: true } : { ok: true, hotkeyError: shortcut.error };
  } catch (err) {
    // El atajo ya estaba registrado cuando fallo la escritura: no debe quedar
    // activo un combinado que no se pudo guardar.
    if (shortcut && shortcut.ok && hotkeyBefore && hotkeyBefore !== bugHotkey) {
      applyBugShortcut(hotkeyBefore);
    }
    return { ok: false, error: err.message };
  }
});

// admiten el payload { config, search } del renderer y devuelven truncated para
// que la interfaz avise cuando GitLab llena la pagina.
ipcMain.handle('gitlab:projects', async (_event, payload) => {
  try {
    const config = payload && payload.config ? payload.config : payload;
    const search = (payload && payload.search) || '';
    const result = await getGitLabProjects(config, search);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('gitlab:branches', async (_event, payload) => {
  try {
    const config = payload && payload.config;
    const result = await getGitLabBranches(
      config,
      payload && payload.projectId,
      (payload && payload.search) || ''
    );
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jira:test', async (_event, config) => {
  try {
    const data = await getMyself(config);
    if (!data) throw new Error('No se pudo obtener el usuario actual');
    return { ok: true, displayName: data.displayName, accountId: data.accountId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jira:notifications', async (_event, config) => {
  try {
    const notifications = await fetchNotifications(config);
    return { ok: true, notifications };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jira:searchIssues', async (_event, payload) => {
  try {
    const found = await searchIssuesForCopy(
      payload && payload.config,
      payload && payload.query
    );
    return {
      ok: true,
      results: found.results,
      ...(found.error ? { error: found.error } : {}),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('jira:issueCopyData', async (_event, payload) => {
  try {
    const config = payload && payload.config;
    const raw = await getCachedCopyRaw(config, payload && payload.issueKey);
    return { ok: true, ...copyDataPreview(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('copy:issue', async (_event, payload) => {
  try {
    const result = await copyIssueToClipboard(
      payload && payload.config,
      payload && payload.issueKey,
      payload || {}
    );
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:list', () => {
  try {
    return { ok: true, items: listBugs() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:create', (_event, payload) => {
  try {
    const { note, failed } = createBug(payload);
    return { ok: true, item: note, failed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:update', (_event, payload) => {
  try {
    const note = updateBug(payload && payload.id, payload && payload.changes);
    return { ok: true, item: note };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:delete', (_event, payload) => {
  try {
    deleteBug(payload && payload.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:image:add', (_event, payload) => {
  try {
    const { note } = addBugImage(payload && payload.id, payload && payload.image);
    return { ok: true, item: note };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:image:read', (_event, payload) => {
  try {
    const dataUrl = readBugImageDataUrl(payload && payload.id, payload && payload.filename);
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:image:delete', (_event, payload) => {
  try {
    const note = removeBugImage(payload && payload.id, payload && payload.filename);
    return { ok: true, item: note };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:markdown', (_event, payload) => {
  try {
    const note = readBugNote(payload && payload.id);
    return { ok: true, markdown: bugToMarkdown(note) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:copyMarkdown', (_event, payload) => {
  try {
    const note = readBugNote(payload && payload.id);
    const markdown = bugToMarkdown(note);
    clipboard.writeText(markdown);
    return { ok: true, chars: markdown.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:copyImagePaths', (_event, payload) => {
  try {
    const note = readBugNote(payload && payload.id);
    if (!note.images.length) throw new Error('La incidencia no tiene imagenes');
    clipboard.writeText(bugImagePaths(note).join('\n'));
    return { ok: true, count: note.images.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:openFolder', async (_event, payload) => {
  try {
    const id = payload && payload.id;
    if (!BUG_ID_PATTERN.test(String(id || ''))) throw new Error('Incidencia no valida');
    fs.mkdirSync(bugDir(id), { recursive: true });
    await shell.openPath(bugDir(id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:openCapture', () => {
  showCaptureWindow();
  return { ok: true };
});

ipcMain.handle('bugs:close', () => {
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
  return { ok: true };
});

ipcMain.handle('bugs:context', () => {
  return {
    ok: true,
    issueKey: lastIssueKey,
    clipboardUrl: clipboardUrl(),
  };
});

ipcMain.handle('bugs:draft:get', () => {
  return { ok: true, draft: readBugDraft() };
});

ipcMain.handle('bugs:draft:save', (_event, draft) => {
  try {
    return { ok: true, saved: saveBugDraft(draft) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bugs:draft:clear', () => {
  clearBugDraft();
  return { ok: true };
});

ipcMain.handle('clipboard:writeText', (_event, text) => {
  if (typeof text !== 'string') return false;
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

function showNotification(title, body, url) {
  if (!Notification.isSupported()) return false;

  const notification = new Notification({
    title: title || 'desTajo',
    body: body || '',
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  if (url) {
    notification.on('click', () => {
      shell.openExternal(url);
    });
  }

  notification.show();
  return true;
}

ipcMain.handle('notify', (_event, payload) => {
  const { title, body, url } = payload || {};
  return showNotification(title, body, url);
});

let updateTimer = null;

function configureUpdater() {
  const config = readConfig();
  const updateUrl = (config && config.updateUrl ? config.updateUrl : '').trim();

  if (updateUrl) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: updateUrl.replace(/\/+$/, '') + '/',
    });
  }
}

function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    showNotification(
      'Actualizacion disponible',
      `Descargando desTajo ${info.version}...`
    );
  });

  autoUpdater.on('update-downloaded', (info) => {
    showNotification(
      'Actualizacion lista',
      `desTajo ${info.version} se instalara al cerrar la aplicacion.`
    );
  });

  autoUpdater.on('error', (err) => {
    console.error('Error del actualizador:', err.message);
  });

  configureUpdater();

  if (!app.isPackaged) return;

  autoUpdater.checkForUpdates().catch(() => {});
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    title: 'desTajo',
    backgroundColor: '#f4f5f7',
    icon: path.join(
      __dirname,
      'assets',
      process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Con bandeja activa, cerrar la ventana la oculta: el atajo de captura debe
  // seguir disponible aunque no haya ventana principal a la vista.
  mainWindow.on('close', (event) => {
    if (isQuitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

const hasSingleInstanceLock =
  typeof app.requestSingleInstanceLock === 'function'
    ? app.requestSingleInstanceLock()
    : true;

if (!hasSingleInstanceLock) {
  app.quit();
} else if (typeof app.on === 'function') {
  app.on('second-instance', () => showMainWindow());
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.destajo.app');
  }
  const config = readConfig();
  applyBugShortcut((config && config.bugHotkey) || DEFAULT_BUG_HOTKEY);
  createWindow();
  setupUpdater();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  if (globalShortcut && typeof globalShortcut.unregisterAll === 'function') {
    globalShortcut.unregisterAll();
  }
});

app.on('window-all-closed', () => {
  // La bandeja mantiene viva la aplicacion para que el atajo siga funcionando.
  if (process.platform !== 'darwin' && !tray) app.quit();
});
