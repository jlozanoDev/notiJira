const els = {
  userInfo: document.getElementById('userInfo'),
  refreshBtn: document.getElementById('refreshBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  statusBar: document.getElementById('statusBar'),
  filterBar: document.getElementById('filterBar'),
  markAllReadBtn: document.getElementById('markAllReadBtn'),
  emptyState: document.getElementById('emptyState'),
  cards: document.getElementById('cards'),
  modal: document.getElementById('modal'),
  configForm: document.getElementById('configForm'),
  baseUrl: document.getElementById('baseUrl'),
  email: document.getElementById('email'),
  apiToken: document.getElementById('apiToken'),
  updateUrl: document.getElementById('updateUrl'),
  formMessage: document.getElementById('formMessage'),
  testBtn: document.getElementById('testBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  searchBtn: document.getElementById('searchBtn'),
  searchModal: document.getElementById('searchModal'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  searchMessage: document.getElementById('searchMessage'),
  searchResults: document.getElementById('searchResults'),
  searchCancelBtn: document.getElementById('searchCancelBtn'),
  searchSubmitBtn: document.getElementById('searchSubmitBtn'),
  copyModal: document.getElementById('copyModal'),
  copyTitle: document.getElementById('copyTitle'),
  copySubtitle: document.getElementById('copySubtitle'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  selectNoneBtn: document.getElementById('selectNoneBtn'),
  copySections: document.getElementById('copySections'),
  copyComments: document.getElementById('copyComments'),
  copyAttachmentsNote: document.getElementById('copyAttachmentsNote'),
  copyMessage: document.getElementById('copyMessage'),
  copyCancelBtn: document.getElementById('copyCancelBtn'),
  copyDoBtn: document.getElementById('copyDoBtn'),
};

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const READ_IDS_KEY = 'notijira:readIds';

function loadReadIds() {
  try {
    const raw = localStorage.getItem(READ_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    return new Set();
  }
}

const state = {
  config: null,
  notifications: [],
  loading: false,
  seenIds: null,
  autoTimer: null,
  audioContext: null,
  readIds: loadReadIds(),
  filter: 'all',
  copyData: null,
  selectedSections: new Set(),
  selectedComments: new Set(),
};

function normalizeBaseUrl(url) {
  if (!url) return '';
  let base = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  return base;
}

function currentFormConfig() {
  return {
    baseUrl: normalizeBaseUrl(els.baseUrl.value),
    email: els.email.value.trim(),
    apiToken: els.apiToken.value.trim(),
    updateUrl: els.updateUrl.value.trim(),
  };
}

function setStatus(message, type) {
  els.statusBar.textContent = message;
  els.statusBar.className = 'status-bar ' + (type || '');
  els.statusBar.classList.remove('hidden');
}

function clearStatus() {
  els.statusBar.classList.add('hidden');
}

function setFormMessage(message, type) {
  els.formMessage.textContent = message || '';
  els.formMessage.className = 'form-message ' + (type || '');
}

function decodeHtml(input) {
  if (!input) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = input;
  return textarea.value;
}

function stripHtml(input) {
  if (!input) return '';
  const div = document.createElement('div');
  div.innerHTML = input;
  return div.textContent || div.innerText || '';
}

function extractIssueKey(notification) {
  const candidates = [
    notification.subject,
    notification.title,
    notification.textBody,
    notification.htmlBody,
    notification.webUrl,
    notification.url,
    notification.issueKey,
  ];
  const context = notification.context || {};
  candidates.push(context.key, context.issueKey, context.id);

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const match = candidate.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/);
    if (match) return match[1];
  }
  return null;
}

function getIssueUrl(notification) {
  const base = normalizeBaseUrl(state.config?.baseUrl || '');
  const direct = notification.webUrl || notification.url;
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) {
    return direct;
  }
  const key = extractIssueKey(notification);
  if (key && base) return `${base}/browse/${key}`;
  if (base) return `${base}/secure/MyJiraHome.jspa`;
  return null;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function persistReadIds() {
  try {
    localStorage.setItem(READ_IDS_KEY, JSON.stringify([...state.readIds]));
  } catch (err) {
    /* almacenamiento no disponible */
  }
}

function setRead(id, read) {
  if (read) state.readIds.add(id);
  else state.readIds.delete(id);
  persistReadIds();
  renderCards();
}

function updateFilterCounts() {
  const total = state.notifications.length;
  const read = state.notifications.filter((item) =>
    state.readIds.has(item.id)
  ).length;
  const counts = { all: total, read, unread: total - read };

  document.querySelectorAll('.filter-count').forEach((el) => {
    el.textContent = counts[el.dataset.count] ?? 0;
  });

  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.filter === state.filter);
  });

  els.markAllReadBtn.disabled = counts.unread === 0;
}

function renderCards() {
  els.cards.innerHTML = '';

  const filter = state.filter;
  const visible = state.notifications.filter((notification) => {
    const isRead = state.readIds.has(notification.id);
    if (filter === 'read') return isRead;
    if (filter === 'unread') return !isRead;
    return true;
  });

  updateFilterCounts();
  els.filterBar.classList.toggle('hidden', state.notifications.length === 0);

  if (!state.notifications.length) {
    els.emptyState.classList.remove('hidden');
    els.emptyState.querySelector('h2').textContent = 'No hay menciones';
    els.emptyState.querySelector('p').textContent =
      'No se han encontrado comentarios donde te mencionen en los ultimos 90 dias. Pulsa en "Actualizar" para volver a comprobar.';
    return;
  }

  if (!visible.length) {
    els.emptyState.classList.remove('hidden');
    els.emptyState.querySelector('h2').textContent =
      filter === 'unread' ? 'No hay menciones no leidas' : 'No hay menciones leidas';
    els.emptyState.querySelector('p').textContent =
      'Cambia el filtro para ver el resto de menciones.';
    return;
  }

  els.emptyState.classList.add('hidden');

  for (const notification of visible) {
    const isRead = state.readIds.has(notification.id);
    const card = document.createElement('article');
    card.className = 'card' + (isRead ? '' : ' unread');

    const subject =
      notification.subject ||
      notification.title ||
      stripHtml(notification.htmlBody) ||
      'Notificacion';

    const bodyRaw = notification.textBody
      ? decodeHtml(stripHtml(notification.textBody))
      : stripHtml(notification.htmlBody) ||
        notification.text ||
        notification.message ||
        '';
    const body = bodyRaw.trim().slice(0, 400);

    const author =
      notification.author?.displayName ||
      notification.actor?.displayName ||
      notification.author?.name ||
      '';

    const reason =
      notification.reason || notification.type || notification.event || '';
    const created =
      formatDate(notification.created || notification.updated || notification.timestamp);
    const issueKey = extractIssueKey(notification);
    const url = getIssueUrl(notification);

    const header = document.createElement('div');
    header.className = 'card-header';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'read-check';
    check.checked = isRead;
    check.title = isRead ? 'Marcar como no leida' : 'Marcar como leida';
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => setRead(notification.id, check.checked));
    header.appendChild(check);

    const h3 = document.createElement('h3');
    h3.className = 'card-subject';
    h3.textContent = subject;
    header.appendChild(h3);
    if (reason) {
      const badge = document.createElement('span');
      badge.className = 'badge' + (isRead ? '' : ' unread');
      badge.textContent = reason;
      header.appendChild(badge);
    }

    card.appendChild(header);

    if (body) {
      const p = document.createElement('p');
      p.className = 'card-body';
      p.textContent = body;
      card.appendChild(p);
    }

    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const left = document.createElement('span');
    left.textContent = author ? `De: ${author}` : created;
    if (author && created) left.textContent = `${author} · ${created}`;
    footer.appendChild(left);
    if (issueKey) {
      const key = document.createElement('span');
      key.className = 'issue-key';
      key.textContent = issueKey;
      footer.appendChild(key);
    }
    card.appendChild(footer);

    if (url) {
      card.title = 'Abrir en Jira';
      card.addEventListener('click', () => {
        if (!state.readIds.has(notification.id)) {
          setRead(notification.id, true);
        }
        window.api.openExternal(url);
      });
    }

    els.cards.appendChild(card);
  }
}

function playNotificationSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!state.audioContext) state.audioContext = new Ctx();
    const ctx = state.audioContext;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, index) => {
      const start = now + index * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch (err) {
    /* el audio no esta disponible */
  }
}

function notifyNewMentions(items) {
  if (!items.length) return;
  playNotificationSound();

  if (items.length === 1) {
    window.api.notify({
      title: 'Nueva mencion en Jira',
      body: items[0].subject,
      url: items[0].webUrl,
    });
    return;
  }

  const keys = items
    .slice(0, 4)
    .map((item) => item.issueKey)
    .filter(Boolean);

  window.api.notify({
    title: `${items.length} nuevas menciones en Jira`,
    body: keys.length ? keys.join(', ') : 'Pulsa para abrir la lista.',
    url: items[0].webUrl,
  });
}

function startAutoRefresh() {
  if (state.autoTimer) clearInterval(state.autoTimer);
  state.autoTimer = setInterval(
    () => loadNotifications({ auto: true }),
    POLL_INTERVAL_MS
  );
}

async function loadNotifications(options = {}) {
  if (!state.config) return;
  if (state.loading) return;

  state.loading = true;
  els.refreshBtn.disabled = true;
  els.refreshBtn.classList.add('loading');
  setStatus(
    'Buscando menciones en los comentarios recientes. Puede tardar unos segundos...',
    ''
  );

  const result = await window.api.getNotifications(state.config);

  state.loading = false;
  els.refreshBtn.disabled = false;
  els.refreshBtn.classList.remove('loading');

  if (!result.ok) {
    setStatus('Error al cargar notificaciones: ' + result.error, 'error');
    return;
  }

  state.notifications = result.notifications || [];
  const ids = state.notifications.map((item) => item.id);

  if (state.seenIds === null) {
    state.seenIds = new Set(ids);
  } else {
    const newItems = state.notifications.filter(
      (item) => !state.seenIds.has(item.id)
    );
    ids.forEach((id) => state.seenIds.add(id));
    if (newItems.length && !options.silent) notifyNewMentions(newItems);
  }

  renderCards();

  if (state.notifications.length) {
    const unread = state.notifications.filter(
      (item) => !state.readIds.has(item.id)
    ).length;
    setStatus(
      `Se han encontrado ${state.notifications.length} menciones (${unread} no leidas). Se actualiza cada 5 min.`,
      'ok'
    );
  } else if (options.auto) {
    setStatus('No hay menciones nuevas. Se actualiza cada 5 min.', 'ok');
  } else {
    setStatus('No se han encontrado menciones en los ultimos 90 dias.', 'ok');
  }
}

async function connectAndLoad() {
  els.userInfo.textContent = 'Conectando...';
  const test = await window.api.testConnection(state.config);
  if (test.ok) {
    els.userInfo.textContent = `Conectado como ${test.displayName || 'usuario'}`;
  } else {
    els.userInfo.textContent = 'Error de conexion';
    setStatus('No se pudo conectar: ' + test.error, 'error');
    els.refreshBtn.disabled = false;
    return;
  }
  els.refreshBtn.disabled = false;
  els.searchBtn.disabled = false;
  await loadNotifications({ silent: true });
  startAutoRefresh();
}

function openModal() {
  els.formMessage.textContent = '';
  els.formMessage.className = 'form-message';
  if (state.config) {
    els.baseUrl.value = state.config.baseUrl || '';
    els.email.value = state.config.email || '';
    els.apiToken.value = state.config.apiToken || '';
    els.updateUrl.value = state.config.updateUrl || '';
  }
  els.modal.classList.remove('hidden');
  els.baseUrl.focus();
}

function closeModal() {
  els.modal.classList.add('hidden');
}

function showNotConfigured() {
  els.emptyState.classList.remove('hidden');
  els.emptyState.querySelector('h2').textContent = 'Configura tu cuenta de Jira';
  els.emptyState.querySelector('p').textContent =
    'Pulsa en "Configuracion" e introduce la URL de tu Jira, tu email y tu API token para empezar a ver tus notificaciones.';
  els.cards.innerHTML = '';
  els.userInfo.textContent = 'Sin conectar';
  els.refreshBtn.disabled = true;
  els.searchBtn.disabled = true;
}

document.querySelectorAll('.filter-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.filter = tab.dataset.filter;
    renderCards();
  });
});

els.markAllReadBtn.addEventListener('click', () => {
  state.notifications.forEach((item) => state.readIds.add(item.id));
  persistReadIds();
  renderCards();
});

els.settingsBtn.addEventListener('click', openModal);
els.cancelBtn.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => {
  if (e.target === els.modal) closeModal();
});

els.testBtn.addEventListener('click', async () => {
  const config = currentFormConfig();
  if (!config.baseUrl || !config.apiToken) {
    setFormMessage('Introduce la URL y el API token.', 'error');
    return;
  }
  setFormMessage('Probando conexion...', '');
  const result = await window.api.testConnection(config);
  if (result.ok) {
    setFormMessage(`Conexion correcta: ${result.displayName || 'usuario'}`, 'ok');
  } else {
    setFormMessage('Error: ' + result.error, 'error');
  }
});

els.configForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const config = currentFormConfig();
  if (!config.baseUrl || !config.apiToken) {
    setFormMessage('Introduce la URL y el API token.', 'error');
    return;
  }

  await window.api.saveConfig(config);
  state.config = config;
  state.seenIds = null;
  closeModal();
  els.refreshBtn.disabled = false;
  await connectAndLoad();
});

els.refreshBtn.addEventListener('click', () => loadNotifications());

// ---------------------------------------------------------------------------
// Buscador de tareas y modal de copia para OpenCode
// ---------------------------------------------------------------------------

function setSearchMessage(message, type) {
  els.searchMessage.textContent = message || '';
  els.searchMessage.className = 'form-message ' + (type || '');
}

function setCopyMessage(message, type) {
  els.copyMessage.textContent = message || '';
  els.copyMessage.className = 'form-message ' + (type || '');
}

function openSearchModal() {
  setSearchMessage('', '');
  els.searchResults.innerHTML = '';
  els.searchResults.classList.add('hidden');
  els.searchInput.value = '';
  els.searchModal.classList.remove('hidden');
  els.searchInput.focus();
}

function closeSearchModal() {
  els.searchModal.classList.add('hidden');
}

function closeCopyModal() {
  els.copyModal.classList.add('hidden');
  state.copyData = null;
}

function renderSearchResults(results) {
  els.searchResults.innerHTML = '';

  if (!results.length) {
    els.searchResults.classList.add('hidden');
    setSearchMessage('Sin resultados. Prueba con otra descripcion.', 'error');
    return;
  }

  els.searchResults.classList.remove('hidden');
  setSearchMessage(
    `${results.length} resultado${results.length === 1 ? '' : 's'}.`,
    'ok'
  );

  for (const item of results) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'search-result';

    const key = document.createElement('span');
    key.className = 'issue-key';
    key.textContent = item.key;
    row.appendChild(key);

    const summary = document.createElement('span');
    summary.className = 'search-result-summary';
    summary.textContent = item.summary;
    row.appendChild(summary);

    if (item.status) {
      const status = document.createElement('span');
      status.className = 'badge';
      status.textContent = item.status;
      row.appendChild(status);
    }

    const updated = document.createElement('span');
    updated.className = 'search-result-date';
    updated.textContent = formatDate(item.updated);
    row.appendChild(updated);

    row.addEventListener('click', () => {
      closeSearchModal();
      openCopyModal(item.key, item.summary);
    });

    els.searchResults.appendChild(row);
  }
}

function copyRow(label, preview, checked, disabled, onChange) {
  const row = document.createElement('label');
  row.className = 'copy-row' + (disabled ? ' disabled' : '');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'read-check';
  check.checked = checked;
  check.disabled = disabled;
  check.addEventListener('change', () => onChange(check.checked));
  row.appendChild(check);

  const text = document.createElement('span');
  text.className = 'copy-row-text';

  const name = document.createElement('span');
  name.className = 'copy-row-label';
  name.textContent = label;
  text.appendChild(name);

  if (preview) {
    const previewEl = document.createElement('span');
    previewEl.className = 'copy-row-preview';
    previewEl.textContent = preview;
    text.appendChild(previewEl);
  }

  row.appendChild(text);
  return row;
}

function renderCopyLists() {
  const data = state.copyData;
  if (!data) return;

  els.copySections.innerHTML = '';
  els.copyComments.innerHTML = '';

  for (const section of data.sections || []) {
    const disabled = !!section.empty;
    const row = copyRow(
      section.label,
      disabled ? 'sin contenido' : section.preview,
      !disabled && state.selectedSections.has(section.id),
      disabled,
      (checked) => {
        if (checked) state.selectedSections.add(section.id);
        else state.selectedSections.delete(section.id);
      }
    );
    els.copySections.appendChild(row);
  }

  const comments = data.comments || [];
  if (!comments.length) {
    const empty = document.createElement('p');
    empty.className = 'copy-note';
    empty.textContent = 'Esta tarea no tiene comentarios.';
    els.copyComments.appendChild(empty);
  } else {
    for (const comment of comments) {
      const author = comment.author || 'Sin autor';
      const when = formatDate(comment.created);
      const row = copyRow(
        when ? `${author} · ${when}` : author,
        comment.preview,
        state.selectedComments.has(comment.id),
        false,
        (checked) => {
          if (checked) state.selectedComments.add(comment.id);
          else state.selectedComments.delete(comment.id);
        }
      );
      els.copyComments.appendChild(row);
    }
  }

  const attachments = data.attachments || [];
  if (attachments.length) {
    els.copyAttachmentsNote.textContent = `Se descargaran ${attachments.length} archivo(s) adjunto(s) a la carpeta de la aplicacion para enlazarlos en la copia.`;
    els.copyAttachmentsNote.classList.remove('hidden');
  } else {
    els.copyAttachmentsNote.classList.add('hidden');
  }
}

async function openCopyModal(issueKey, summary) {
  state.copyData = null;
  state.selectedSections = new Set();
  state.selectedComments = new Set();

  els.copyTitle.textContent = `Copiar ${issueKey}`;
  els.copySubtitle.textContent = summary
    ? `${issueKey} — ${summary} · Cargando...`
    : 'Cargando...';
  els.copySections.innerHTML = '';
  els.copyComments.innerHTML = '';
  els.copyAttachmentsNote.classList.add('hidden');
  setCopyMessage('', '');
  els.copyDoBtn.disabled = true;
  els.copyModal.classList.remove('hidden');

  const result = await window.api.getIssueCopyData(state.config, issueKey);

  if (!result.ok) {
    els.copySubtitle.textContent = summary ? `${issueKey} — ${summary}` : issueKey;
    setCopyMessage('Error al cargar la tarea: ' + result.error, 'error');
    return;
  }

  state.copyData = result;
  for (const section of result.sections || []) {
    if (!section.empty) state.selectedSections.add(section.id);
  }
  for (const comment of result.comments || []) {
    state.selectedComments.add(comment.id);
  }

  els.copySubtitle.textContent = `${result.issue.key} — ${result.issue.summary}`;
  renderCopyLists();
  els.copyDoBtn.disabled = false;
}

els.searchBtn.addEventListener('click', openSearchModal);
els.searchCancelBtn.addEventListener('click', closeSearchModal);
els.searchModal.addEventListener('click', (e) => {
  if (e.target === els.searchModal) closeSearchModal();
});

els.searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.config) {
    setSearchMessage('Configura Jira primero.', 'error');
    return;
  }
  const query = els.searchInput.value.trim();
  if (!query) {
    setSearchMessage('Escribe una clave de tarea o una descripcion.', 'error');
    return;
  }

  els.searchSubmitBtn.disabled = true;
  setSearchMessage('Buscando...', '');
  const result = await window.api.searchIssues(state.config, query);
  els.searchSubmitBtn.disabled = false;

  if (!result.ok) {
    els.searchResults.innerHTML = '';
    els.searchResults.classList.add('hidden');
    setSearchMessage('Error: ' + result.error, 'error');
    return;
  }
  renderSearchResults(result.results || []);
  if (result.error) {
    setSearchMessage(
      result.error +
        (result.results && result.results.length ? '' : ' Sin resultados.'),
      'error'
    );
  }
});

els.selectAllBtn.addEventListener('click', () => {
  const data = state.copyData;
  if (!data) return;
  for (const section of data.sections || []) {
    if (!section.empty) state.selectedSections.add(section.id);
  }
  for (const comment of data.comments || []) {
    state.selectedComments.add(comment.id);
  }
  renderCopyLists();
});

els.selectNoneBtn.addEventListener('click', () => {
  state.selectedSections = new Set();
  state.selectedComments = new Set();
  renderCopyLists();
});

els.copyCancelBtn.addEventListener('click', closeCopyModal);
els.copyModal.addEventListener('click', (e) => {
  if (e.target === els.copyModal) closeCopyModal();
});

els.copyDoBtn.addEventListener('click', async () => {
  const data = state.copyData;
  if (!data) return;

  const sections = [...state.selectedSections];
  const comments = [...state.selectedComments];
  if (!sections.length && !comments.length) {
    setCopyMessage('Selecciona al menos una seccion o un comentario.', 'error');
    return;
  }

  els.copyDoBtn.disabled = true;
  setCopyMessage('Copiando y descargando archivos...', '');
  const result = await window.api.copyIssue(state.config, {
    issueKey: data.issue.key,
    sections,
    comments,
  });
  els.copyDoBtn.disabled = false;

  if (!result.ok) {
    setCopyMessage('Error: ' + result.error, 'error');
    return;
  }

  closeCopyModal();
  const parts = [];
  if (result.sections) parts.push(`${result.sections} seccion(es)`);
  if (result.comments) parts.push(`${result.comments} comentario(s)`);
  if (result.attachments) parts.push(`${result.attachments} archivo(s)`);
  let extra = '';
  if (result.failed) extra = ` (${result.failed} archivo(s) sin descargar)`;
  if (result.folder) extra += ` · Archivos en ${result.folder}`;
  setStatus(`Copiado al portapapeles: ${parts.join(', ')}.${extra}`, 'ok');
});

async function init() {
  const config = await window.api.getConfig();
  if (!config || !config.baseUrl || !config.apiToken) {
    showNotConfigured();
    openModal();
    return;
  }
  state.config = config;
  els.refreshBtn.disabled = false;
  await connectAndLoad();
}

init();
