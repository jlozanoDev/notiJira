const { app, BrowserWindow, ipcMain, shell, Notification, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { adfToMarkdown, collectMedia } = require('./adf');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

async function searchIssuesForCopy(config, query) {
  const text = String(query || '').trim();
  if (!text) throw new Error('Escribe una clave de tarea o una descripcion');
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  let notice = '';
  const keyMatch = text.match(/^([A-Za-z][A-Za-z0-9_]*-\d+)$/);
  if (keyMatch) {
    try {
      const issue = await jiraRequest(
        config,
        `/rest/api/3/issue/${keyMatch[1].toUpperCase()}?fields=summary,status,issuetype,updated`
      );
      return { results: [searchResult(issue, baseUrl)] };
    } catch (err) {
      if (err.status !== 404) throw err;
      // La clave no existe: se avisa y se permite buscar igualmente por texto
      notice = `La tarea ${keyMatch[1].toUpperCase()} no existe; se busca como texto.`;
    }
  }

  const jql = `text ~ "${escapeJqlText(text)}" ORDER BY updated DESC`;
  const search = await searchIssues(
    config,
    jql,
    ['summary', 'status', 'issuetype', 'updated'],
    20
  );
  return {
    results: (search.issues || []).map((issue) => searchResult(issue, baseUrl)),
    error: notice || undefined,
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

ipcMain.handle('config:get', () => {
  const config = readConfig();
  if (!config) return null;
  return {
    baseUrl: config.baseUrl || '',
    email: config.email || '',
    apiToken: config.apiToken || '',
    updateUrl: config.updateUrl || '',
  };
});

ipcMain.handle('config:save', (_event, config) => {
  writeConfig({
    baseUrl: normalizeBaseUrl(config.baseUrl),
    email: (config.email || '').trim(),
    apiToken: (config.apiToken || '').trim(),
    updateUrl: (config.updateUrl || '').trim(),
  });
  configureUpdater();
  return true;
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
    title: title || 'NotiJira',
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
      `Descargando NotiJira ${info.version}...`
    );
  });

  autoUpdater.on('update-downloaded', (info) => {
    showNotification(
      'Actualizacion lista',
      `NotiJira ${info.version} se instalara al cerrar la aplicacion.`
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
    title: 'NotiJira',
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
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.notijira.app');
  }
  createWindow();
  setupUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
