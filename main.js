const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

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

async function searchIssues(config, jql, fields) {
  try {
    return await jiraRequest(config, '/rest/api/3/search/jql', {
      method: 'POST',
      body: {
        jql,
        maxResults: 100,
        fields,
      },
    });
  } catch (err) {
    if (err.status !== 404 && err.status !== 410) throw err;

    const params = new URLSearchParams({
      jql,
      maxResults: '100',
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
