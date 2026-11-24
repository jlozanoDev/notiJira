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
  gitlabUrl: document.getElementById('gitlabUrl'),
  gitlabToken: document.getElementById('gitlabToken'),
  saveGitlabCredentialsBtn: document.getElementById('saveGitlabCredentialsBtn'),
  removeGitlabCredentialsBtn: document.getElementById('removeGitlabCredentialsBtn'),
  formMessage: document.getElementById('formMessage'),
  testBtn: document.getElementById('testBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  searchBtn: document.getElementById('searchBtn'),
  searchModal: document.getElementById('searchModal'),
  searchInput: document.getElementById('searchInput'),
  searchList: document.getElementById('searchList'),
  searchMessage: document.getElementById('searchMessage'),
  searchCancelBtn: document.getElementById('searchCancelBtn'),
  copyModal: document.getElementById('copyModal'),
  copyTitle: document.getElementById('copyTitle'),
  copySubtitle: document.getElementById('copySubtitle'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  selectNoneBtn: document.getElementById('selectNoneBtn'),
  copySections: document.getElementById('copySections'),
  copyComments: document.getElementById('copyComments'),
  copyAttachmentsNote: document.getElementById('copyAttachmentsNote'),
  includeMrCheckbox: document.getElementById('includeMrCheckbox'),
  gitlabSelection: document.getElementById('gitlabSelection'),
  gitlabProjectInput: document.getElementById('gitlabProjectInput'),
  gitlabProjectList: document.getElementById('gitlabProjectList'),
  gitlabSourceBranchInput: document.getElementById('gitlabSourceBranchInput'),
  gitlabSourceBranchList: document.getElementById('gitlabSourceBranchList'),
  gitlabTargetBranchInput: document.getElementById('gitlabTargetBranchInput'),
  gitlabTargetBranchList: document.getElementById('gitlabTargetBranchList'),
  gitlabMessage: document.getElementById('gitlabMessage'),
  copyMessage: document.getElementById('copyMessage'),
  copyCancelBtn: document.getElementById('copyCancelBtn'),
  copyDoBtn: document.getElementById('copyDoBtn'),

  // Bandeja de incidencias
  bugsBtn: document.getElementById('bugsBtn'),
  bugsCount: document.getElementById('bugsCount'),
  bugsModal: document.getElementById('bugsModal'),
  bugNewBtn: document.getElementById('bugNewBtn'),
  bugsCloseBtn: document.getElementById('bugsCloseBtn'),
  bugSearch: document.getElementById('bugSearch'),
  bugList: document.getElementById('bugList'),
  bugEmpty: document.getElementById('bugEmpty'),
  bugDetailBody: document.getElementById('bugDetailBody'),
  bugTitleInput: document.getElementById('bugTitleInput'),
  bugDetailsInput: document.getElementById('bugDetailsInput'),
  bugLinkInput: document.getElementById('bugLinkInput'),
  bugAddLinkBtn: document.getElementById('bugAddLinkBtn'),
  bugLinkChips: document.getElementById('bugLinkChips'),
  bugIssueInput: document.getElementById('bugIssueInput'),
  bugAddImageBtn: document.getElementById('bugAddImageBtn'),
  bugImageInput: document.getElementById('bugImageInput'),
  bugImages: document.getElementById('bugImages'),
  bugImagesEmpty: document.getElementById('bugImagesEmpty'),
  bugCreatedRow: document.getElementById('bugCreatedRow'),
  bugJiraKeyInput: document.getElementById('bugJiraKeyInput'),
  bugMarkCreatedBtn: document.getElementById('bugMarkCreatedBtn'),
  bugCreatedInfo: document.getElementById('bugCreatedInfo'),
  bugMeta: document.getElementById('bugMeta'),
  bugSaveBtn: document.getElementById('bugSaveBtn'),
  bugCopyMdBtn: document.getElementById('bugCopyMdBtn'),
  bugCopyPathsBtn: document.getElementById('bugCopyPathsBtn'),
  bugOpenFolderBtn: document.getElementById('bugOpenFolderBtn'),
  bugArchiveBtn: document.getElementById('bugArchiveBtn'),
  bugDeleteBtn: document.getElementById('bugDeleteBtn'),
  bugMessage: document.getElementById('bugMessage'),
  bugTabPending: document.getElementById('bugTabPending'),
  bugTabCreated: document.getElementById('bugTabCreated'),
  bugTabAll: document.getElementById('bugTabAll'),
  bugCountPending: document.getElementById('bugCountPending'),
  bugCountCreated: document.getElementById('bugCountCreated'),
  bugCountAll: document.getElementById('bugCountAll'),
  bugHotkey: document.getElementById('bugHotkey'),
  bugStartAtLogin: document.getElementById('bugStartAtLogin'),
};

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const READ_IDS_KEY = 'notijira:readIds';
const SEARCH_MIN_CHARS = 2;

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
  returnToCopyModal: false,
  gitlabSession: 0,
  bugs: [],
  bugFilter: 'pending',
  bugSearch: '',
  bugSelectedId: null,
  bugLinks: [],
  bugDeleteArmed: false,
  bugSettingsLoaded: false,
};

function normalizeBaseUrl(url) {
  if (!url) return '';
  let base = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  return base;
}

// El atajo se muestra con etiquetas cortas y se envia en la forma que espera
// globalShortcut; main.js aplica las mismas reglas de normalizacion.
const DEFAULT_BUG_HOTKEY = 'Control+Alt+J';
const HOTKEY_KEY_PATTERN = /^[A-Za-z0-9]{1,10}$/;

function normalizeAccelerator(value) {
  const parts = String(value || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return '';
  const key = parts.pop();
  if (!HOTKEY_KEY_PATTERN.test(key)) return '';
  const modifiers = [];
  for (const part of parts) {
    const modifier =
      {
        ctrl: 'Control',
        control: 'Control',
        alt: 'Alt',
        shift: 'Shift',
        super: 'Super',
        meta: 'Super',
        cmd: 'Super',
        command: 'Super',
        win: 'Super',
        windows: 'Super',
      }[part.toLowerCase()] || '';
    if (!modifier || modifiers.includes(modifier)) return '';
    modifiers.push(modifier);
  }
  if (!modifiers.length) return '';
  const normalizedKey = /^[A-Za-z]$/.test(key) ? key.toUpperCase() : key;
  return [...modifiers, normalizedKey].join('+');
}

function hotkeyLabel(accelerator) {
  return String(accelerator || '')
    .split('+')
    .map((part) => (part === 'Control' ? 'Ctrl' : part === 'Super' ? 'Win' : part))
    .join('+');
}

function acceleratorFromEvent(event) {
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  const code = String(event.code || '');
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  return { modifiers, key };
}

function currentFormConfig() {
  const config = {
    baseUrl: normalizeBaseUrl(els.baseUrl.value),
    email: els.email.value.trim(),
    apiToken: els.apiToken.value.trim(),
    updateUrl: els.updateUrl.value.trim(),
    gitlabUrl: els.gitlabUrl.value.trim(),
    gitlabToken: els.gitlabToken.value.trim(),
  };
  // Sin el formulario cargado no se sabe si los campos reflejan lo guardado:
  // se omite la clave y main.js conserva la almacenada.
  if (state.bugSettingsLoaded) {
    config.bugHotkey = normalizeAccelerator(els.bugHotkey.value) || DEFAULT_BUG_HOTKEY;
    config.bugStartAtLogin = els.bugStartAtLogin.checked;
  }
  return config;
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
    els.gitlabUrl.value = state.config.gitlabUrl || '';
    els.gitlabToken.value = state.config.gitlabToken || '';
    applyBugConfigToForm(state.config);
    state.bugSettingsLoaded = true;
  }
  els.modal.classList.remove('hidden');
  els.baseUrl.focus();
}

function closeModal() {
  els.modal.classList.add('hidden');
  if (state.returnToCopyModal) {
    state.returnToCopyModal = false;
    els.includeMrCheckbox.checked = false;
    setGitlabSelectionVisible(false);
    els.copyModal.classList.remove('hidden');
  }
}

// Vuelve a la modal de copia tras configurar GitLab dejando el check activo y
// los selectores visibles; no hace nada si la configuracion se abrio sola.
function restoreCopyModalAfterGitlabSetup() {
  if (!state.returnToCopyModal) return false;
  state.returnToCopyModal = false;
  els.modal.classList.add('hidden');
  els.copyModal.classList.remove('hidden');
  els.includeMrCheckbox.checked = true;
  setGitlabSelectionVisible(true);
  loadGitlabProjects();
  return true;
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

// Las pestanas de la modal de incidencias reutilizan la clase filter-tab: se
// descarta cualquier ficha sin data-filter para no pisar state.filter.
document.querySelectorAll('.filter-tab').forEach((tab) => {
  if (!tab.dataset.filter) return;
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

  const result = await window.api.saveConfig(config);
  if (!result || !result.ok) {
    setFormMessage('Error al guardar: ' + ((result && result.error) || 'desconocido'), 'error');
    return;
  }
  state.config = (await window.api.getConfig()) || config;
  state.seenIds = null;
  if (result.hotkeyError) {
    // El resto de ajustes si se guardo: se muestra el atajo que sigue activo y
    // la modal queda abierta para probar otra combinacion.
    applyBugConfigToForm(state.config);
    setFormMessage(result.hotkeyError, 'error');
  } else {
    const resumed = restoreCopyModalAfterGitlabSetup();
    if (!resumed) closeModal();
  }
  els.refreshBtn.disabled = false;
  await connectAndLoad();
});

els.saveGitlabCredentialsBtn.addEventListener('click', async () => {
  const config = currentFormConfig();
  if (!config.gitlabUrl || !config.gitlabToken) {
    setFormMessage('Introduce la URL y el token de GitLab.', 'error');
    return;
  }
  const result = await window.api.saveConfig(config);
  if (!result || !result.ok) {
    setFormMessage(
      'Error al guardar las credenciales: ' + ((result && result.error) || 'desconocido'),
      'error'
    );
    return;
  }
  state.config = (await window.api.getConfig()) || config;
  setFormMessage('Credenciales de GitLab guardadas.', 'ok');
  restoreCopyModalAfterGitlabSetup();
});

els.removeGitlabCredentialsBtn.addEventListener('click', async () => {
  const config = currentFormConfig();
  config.gitlabUrl = '';
  config.gitlabToken = '';
  const result = await window.api.saveConfig(config);
  if (!result || !result.ok) {
    setFormMessage(
      'Error al eliminar las credenciales: ' + ((result && result.error) || 'desconocido'),
      'error'
    );
    return;
  }
  state.config = (await window.api.getConfig()) || config;
  els.gitlabUrl.value = '';
  els.gitlabToken.value = '';
  setFormMessage('Credenciales de GitLab eliminadas.', 'ok');
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

function setGitlabMessage(message, type) {
  els.gitlabMessage.textContent = message || '';
  els.gitlabMessage.className = 'form-message ' + (type || '');
}

function openSearchModal() {
  searchCombo.reset();
  setSearchMessage(
    state.config ? '' : 'Configura Jira primero.',
    state.config ? '' : 'error'
  );
  els.searchModal.classList.remove('hidden');
  els.searchInput.focus();
}

function closeSearchModal() {
  searchCombo.reset();
  els.searchModal.classList.add('hidden');
}

function closeCopyModal() {
  els.copyModal.classList.add('hidden');
  state.copyData = null;
}

// Contenido de cada opcion del combo del buscador: clave, resumen, estado y
// fecha en una sola fila, con el resumen truncado.
function renderSearchOption(item, option) {
  option.classList.add('result-option');

  const key = document.createElement('span');
  key.className = 'issue-key';
  key.textContent = item.key;
  option.appendChild(key);

  const summary = document.createElement('span');
  summary.className = 'search-result-summary';
  summary.textContent = item.summary;
  option.appendChild(summary);

  if (item.status) {
    const status = document.createElement('span');
    status.className = 'badge';
    status.textContent = item.status;
    option.appendChild(status);
  }

  const updated = document.createElement('span');
  updated.className = 'search-result-date';
  updated.textContent = formatDate(item.updated);
  option.appendChild(updated);
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

// ---------------------------------------------------------------------------
// Buscadores de proyecto y ramas de GitLab. El texto se envia a GitLab con el
// parametro `search` (con retardo) y se muestra lo que devuelve, en lugar de
// descargar todas las paginas y filtrar aqui.
// ---------------------------------------------------------------------------

const COMBO_VISIBLE = 12;
const COMBO_NO_MATCH = 'Sin coincidencias';
const COMBO_PAGE_SIZE = 100;
const COMBO_SEARCH_DEBOUNCE_MS = 250;

function createCombo(input, list, options) {
  const combo = {
    input,
    list,
    label: options.label,
    fetchItems: options.fetchItems,
    onChange: options.onChange || null,
    prerequisite: options.prerequisite || null,
    renderOption: options.renderOption || null,
    onResults: options.onResults || null,
    setMessage: options.setMessage || (() => {}),
    isActive: options.isActive || (() => true),
    session: options.session || (() => 0),
    minChars: options.minChars || 0,
    visible: options.visible || COMBO_VISIBLE,
    commitOnBlur: options.commitOnBlur !== false,
    keepTypedOnEscape: options.keepTypedOnEscape === true,
    disableWhenInactive: options.disableWhenInactive === true,
    closeOnError: options.closeOnError === true,
    items: [],
    shown: [],
    selected: null,
    active: -1,
    open: false,
    seq: 0,
    timer: null,
  };

  // Las sugerencias ya vienen filtradas por el servidor.
  combo.matches = () => combo.items.slice(0, combo.visible);

  combo.render = () => {
    combo.list.innerHTML = '';
    if (!combo.open) {
      combo.shown = [];
      combo.active = -1;
      return;
    }
    combo.shown = combo.matches();
    if (!combo.shown.length) {
      const empty = document.createElement('li');
      empty.className = 'combo-empty';
      empty.textContent = COMBO_NO_MATCH;
      combo.list.appendChild(empty);
      combo.active = -1;
      return;
    }
    if (combo.active >= combo.shown.length) combo.active = combo.shown.length - 1;
    combo.shown.forEach((item, index) => {
      const option = document.createElement('li');
      option.className = 'combo-option';
      if (index === combo.active) option.classList.add('active');
      if (combo.selected && combo.selected.value === item.value) {
        option.classList.add('selected');
      }
      option.setAttribute('role', 'option');
      option.setAttribute(
        'aria-selected',
        String(!!(combo.selected && combo.selected.value === item.value))
      );
      if (combo.renderOption) combo.renderOption(item, option);
      else option.textContent = item.label;
      option.addEventListener('mousedown', (event) => {
        if (event && event.preventDefault) event.preventDefault();
        combo.choose(item);
      });
      combo.list.appendChild(option);
    });
  };

  combo.setOpen = (open) => {
    combo.open = open;
    combo.list.classList.toggle('hidden', !open);
    combo.input.setAttribute('aria-expanded', open ? 'true' : 'false');
    combo.render();
  };

  combo.apply = (item) => {
    combo.selected = item || null;
    combo.input.value = item ? item.label : '';
    combo.active = -1;
  };

  combo.choose = (item) => {
    if (!item) return;
    combo.apply(item);
    combo.setOpen(false);
    if (combo.onChange) combo.onChange(item);
  };

  // El campo se puede editar mientras el panel esté abierto y tenga algo que
  // buscar: sin proyecto no hay ramas que listar, pero un fallo de red no debe
  // bloquear el reintento.
  combo.ready = () => (combo.prerequisite ? !!combo.prerequisite() : true);
  combo.refreshDisabled = () => {
    if (!combo.disableWhenInactive) return;
    if (!combo.isActive()) {
      combo.input.disabled = true;
      return;
    }
    combo.input.disabled = !(combo.items.length > 0 || combo.ready());
  };

  // Lista fijada por el codigo (primera pagina o reset): manda sobre el campo.
  combo.applyItems = (items) => {
    combo.items = Array.isArray(items) ? items : [];
    combo.apply(null);
    combo.setOpen(false);
    combo.refreshDisabled();
  };

  // Respuesta de una busqueda: respeta lo escrito y la eleccion si sigue viable.
  combo.applySearchItems = (items, truncated) => {
    combo.items = Array.isArray(items) ? items : [];
    combo.refreshDisabled();
    if (truncated) {
      combo.setMessage(
        `Se muestran solo los primeros ${COMBO_PAGE_SIZE} resultados; escribe un texto mas concreto.`,
        'error'
      );
    }
    if (combo.selected && !combo.items.some((item) => item.value === combo.selected.value)) {
      combo.selected = null;
    }
    combo.shown = [];
    combo.active = -1;
    if (combo.open) combo.render();
  };

  // Deja el campo como nuevo: sin texto, sin eleccion y sin respuestas en vuelo.
  combo.applyQuery = () => {
    combo.seq += 1;
    if (combo.timer) {
      clearTimeout(combo.timer);
      combo.timer = null;
    }
    combo.items = [];
    combo.apply(null);
    combo.setOpen(false);
    combo.refreshDisabled();
  };

  combo.reset = combo.applyQuery;

  // Busca en GitLab. `immediate` salta el retardo (carga inicial y al copiar).
  combo.request = (query, immediate) => {
    const seq = ++combo.seq;
    const session = combo.session();
    if (combo.timer) {
      clearTimeout(combo.timer);
      combo.timer = null;
    }
    const run = async () => {
      combo.timer = null;
      let result;
      try {
        result = await combo.fetchItems(String(query || ''));
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (seq !== combo.seq || session !== combo.session()) return;
      if (!combo.isActive()) return;
      if (!result.ok) {
        combo.applySearchItems([], false);
        if (combo.closeOnError) combo.setOpen(false);
        combo.setMessage(`Error al consultar ${combo.label}: ${result.error}`, 'error');
        return result;
      }
      combo.applySearchItems(result.items, result.truncated);
      if (combo.onResults) combo.onResults(result, combo.items);
      return result;
    };
    if (immediate) return run();
    return new Promise((resolve) => {
      combo.timer = setTimeout(() => {
        run().then(resolve, resolve);
      }, COMBO_SEARCH_DEBOUNCE_MS);
    });
  };

  combo.search = async (query, options = {}) => {
    const term = String(query || '').trim();
    combo.selected = null;
    combo.input.value = term;
    combo.active = -1;
    combo.refreshDisabled();
    combo.setOpen(options.open !== false);

    const result = await combo.request(term, options.immediate !== false);
    if (!result || !result.ok || options.selectExact !== true) return result;

    const exact = combo.items.find(
      (item) => item.label.trim().toLowerCase() === term.toLowerCase()
    );
    if (exact) combo.choose(exact);
    return result;
  };

  // Solo texto escrito: vale si es el nombre exacto de una sugerencia. Si la
  // lista esta cerrada se pide a GitLab antes de decidir.
  combo.commitTyped = async () => {
    const text = combo.input.value.trim();
    if (!text) {
      combo.apply(null);
      combo.render();
      return null;
    }
    const exact = (items) =>
      (items || []).find((item) => item.label.toLowerCase() === text.toLowerCase()) || null;

    let match = exact(combo.items);
    if (!match && !combo.open) {
      await combo.request(text, true);
      match = exact(combo.items);
    }
    if (match) {
      if (!combo.selected || combo.selected.value !== match.value) {
        combo.selected = match;
        combo.input.value = match.label;
        combo.render();
        if (combo.onChange) combo.onChange(match);
      }
      return match;
    }
    if (combo.selected) {
      combo.selected = null;
      combo.render();
    }
    return null;
  };

  combo.input.addEventListener('input', () => {
    combo.selected = null;
    combo.active = -1;
    const term = combo.input.value.trim();
    if (term.length < combo.minChars) {
      combo.seq += 1;
      if (combo.timer) {
        clearTimeout(combo.timer);
        combo.timer = null;
      }
      combo.items = [];
      combo.setOpen(false);
      combo.setMessage(
        term ? `Escribe al menos ${combo.minChars} caracteres.` : '',
        term ? 'error' : ''
      );
      return;
    }
    combo.setOpen(true);
    combo.request(term, false);
  });
  combo.input.addEventListener('focus', () => {
    if (combo.input.value.trim().length >= combo.minChars) combo.setOpen(true);
  });
  combo.input.addEventListener('blur', () => {
    combo.setOpen(false);
    if (combo.commitOnBlur) combo.commitTyped();
  });
  combo.input.addEventListener('keydown', (event) => {
    const key = event && event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (event.preventDefault) event.preventDefault();
      if (!combo.open) combo.setOpen(true);
      if (!combo.shown.length) return;
      const last = combo.shown.length - 1;
      if (key === 'ArrowDown') combo.active = combo.active < 0 ? 0 : Math.min(combo.active + 1, last);
      else combo.active = combo.active < 0 ? last : Math.max(combo.active - 1, 0);
      combo.render();
      return;
    }
    if (key === 'Enter') {
      if (event.preventDefault) event.preventDefault();
      if (combo.open && combo.active >= 0 && combo.shown[combo.active]) {
        combo.choose(combo.shown[combo.active]);
        return;
      }
      const onlyMatch = combo.open && combo.matches().length === 1 ? combo.matches()[0] : null;
      if (onlyMatch) {
        combo.choose(onlyMatch);
        return;
      }
      combo.setOpen(false);
      combo.commitTyped();
      return;
    }
    if (key === 'Escape') {
      if (event.preventDefault) event.preventDefault();
      if (combo.keepTypedOnEscape) {
        combo.setOpen(false);
        return;
      }
      combo.apply(combo.selected);
      combo.setOpen(false);
    }
  });

  combo.setOpen(false);
  return combo;
}

// Opciones comunes de los combos de GitLab: solo cuentan cuando el panel de MR
// esta abierto, y cualquier cambio de sesion invalida las respuestas en vuelo.
const gitlabComboBase = (extra) =>
  Object.assign(
    {
      isActive: () =>
        els.includeMrCheckbox.checked && !els.gitlabSelection.classList.contains('hidden'),
      session: () => state.gitlabSession,
      setMessage: setGitlabMessage,
      disableWhenInactive: true,
    },
    extra
  );

const gitlabProjectCombo = createCombo(
  els.gitlabProjectInput,
  els.gitlabProjectList,
  gitlabComboBase({
    // El texto del error de proyectos se mantiene igual que antes de la busqueda.
    label: 'GitLab',
    fetchItems: fetchGitlabProjectItems,
    onChange: (project) => loadGitlabBranches(project.value),
  })
);
const gitlabSourceCombo = createCombo(
  els.gitlabSourceBranchInput,
  els.gitlabSourceBranchList,
  gitlabComboBase({
    label: 'las ramas',
    fetchItems: (term) => fetchGitlabBranchItems(term),
    prerequisite: () => !!gitlabProjectCombo.selected,
  })
);
const gitlabTargetCombo = createCombo(
  els.gitlabTargetBranchInput,
  els.gitlabTargetBranchList,
  gitlabComboBase({
    label: 'las ramas',
    fetchItems: (term) => fetchGitlabBranchItems(term),
    prerequisite: () => !!gitlabProjectCombo.selected,
  })
);
const gitlabCombos = [gitlabProjectCombo, gitlabSourceCombo, gitlabTargetCombo];

// ---------------------------------------------------------------------------
// Buscador de tareas: el mismo combo que GitLab, alimentado por jira:searchIssues
// ---------------------------------------------------------------------------

const SEARCH_EMPTY_HINT =
  'Sin coincidencias. Prueba con otra descripcion o con la clave completa.';

function issueItem(issue) {
  return Object.assign({}, issue, {
    label: `${issue.key} — ${issue.summary}`,
    value: issue.key,
  });
}

const searchCombo = createCombo(els.searchInput, els.searchList, {
  label: 'Jira',
  minChars: SEARCH_MIN_CHARS,
  visible: 8,
  commitOnBlur: false,
  keepTypedOnEscape: true,
  closeOnError: true,
  setMessage: setSearchMessage,
  fetchItems: async (term) => {
    if (!state.config) return { ok: true, items: [] };
    let result;
    try {
      result = await window.api.searchIssues(state.config, term);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      items: (result.results || []).map(issueItem),
      notice: result.error || '',
    };
  },
  renderOption: renderSearchOption,
  onResults: (result, items) => {
    if (result.notice && !items.length) {
      setSearchMessage(result.notice, 'error');
      return;
    }
    if (items.length) {
      setSearchMessage(
        `${items.length} coincidencia${items.length === 1 ? '' : 's'}.`,
        'ok'
      );
      return;
    }
    setSearchMessage(SEARCH_EMPTY_HINT, 'error');
  },
  onChange: (item) => {
    closeSearchModal();
    openCopyModal(item.value, item.summary);
  },
});

function projectLabel(project) {
  return project.pathWithNamespace || project.name || String(project.id);
}

function branchItems(branches) {
  return (branches || []).map((branch) => ({ value: branch.name, label: branch.name }));
}

async function fetchGitlabProjectItems(term) {
  const result = await window.api.getGitlabProjects(state.config, term);
  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || 'respuesta no valida' };
  }
  return {
    ok: true,
    truncated: !!result.truncated,
    items: (result.projects || []).map((project) => ({
      value: String(project.id),
      label: projectLabel(project),
    })),
  };
}

// Las ramas pertenecen al proyecto elegido; sin proyecto no hay busqueda.
async function fetchGitlabBranchItems(term) {
  const project = gitlabProjectCombo.selected;
  if (!project) return { ok: true, items: [], truncated: false };
  const result = await window.api.getGitlabBranches(state.config, project.value, term);
  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || 'respuesta no valida' };
  }
  return { ok: true, truncated: !!result.truncated, items: branchItems(result.branches) };
}

function noteTruncated(truncated) {
  if (!truncated) return false;
  setGitlabMessage(
    `Se muestran solo los primeros ${COMBO_PAGE_SIZE} resultados; escribe un texto mas concreto.`,
    'error'
  );
  return true;
}

function setGitlabSelectionVisible(visible) {
  state.gitlabSession += 1;
  els.gitlabSelection.classList.toggle('hidden', !visible);
  setGitlabMessage('', '');
  gitlabProjectCombo.reset();
  gitlabSourceCombo.reset();
  gitlabTargetCombo.reset();
}

// Primera pagina de proyectos: al abrir el panel y al volver de la configuracion.
function loadGitlabProjects() {
  setGitlabMessage('Consultando proyectos de GitLab...', '');
  return gitlabProjectCombo.request('', true);
}

// Al elegir proyecto se inicia la busqueda por defecto para cada rama:
// la clave Jira en origen y `develop` en destino.
async function loadGitlabBranches(projectId) {
  gitlabSourceCombo.reset();
  gitlabTargetCombo.reset();
  const session = state.gitlabSession;
  if (!projectId) {
    setGitlabMessage('', '');
    return;
  }

  const issueKey =
    state.copyData && state.copyData.issue
      ? String(state.copyData.issue.key || '').trim()
      : '';
  if (!issueKey) {
    setGitlabMessage('No se pudo obtener la clave Jira para buscar la rama de origen.', 'error');
    return;
  }

  const [sourceResult, targetResult] = await Promise.all([
    gitlabSourceCombo.search(issueKey, { immediate: true, open: true, selectExact: true }),
    gitlabTargetCombo.search('develop', { immediate: true, open: true, selectExact: true }),
  ]);
  if (session !== state.gitlabSession || !els.includeMrCheckbox.checked) return;

  if (
    (sourceResult && sourceResult.truncated) ||
    (targetResult && targetResult.truncated)
  ) {
    noteTruncated(true);
    return;
  }
  if (!sourceResult || !sourceResult.ok || !targetResult || !targetResult.ok) return;
  setGitlabMessage(
    `Búsquedas predeterminadas: origen ${issueKey}, destino develop. Escribe para ajustar cualquiera.`,
    'ok'
  );
}

function openGitlabSettingsForCopy() {
  state.returnToCopyModal = true;
  els.copyModal.classList.add('hidden');
  openModal();
  setFormMessage('Configura la URL y el token de GitLab para obtener el MR.', '');
  els.gitlabUrl.focus();
}

async function openCopyModal(issueKey, summary) {
  state.copyData = null;
  state.selectedSections = new Set();
  state.selectedComments = new Set();
  els.includeMrCheckbox.checked = false;
  setGitlabSelectionVisible(false);

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

els.includeMrCheckbox.addEventListener('change', () => {
  if (!els.includeMrCheckbox.checked) {
    setGitlabSelectionVisible(false);
    return;
  }
  if (!state.config.gitlabUrl || !state.config.gitlabToken) {
    setGitlabSelectionVisible(false);
    openGitlabSettingsForCopy();
    return;
  }
  setGitlabSelectionVisible(true);
  loadGitlabProjects();
});

els.searchBtn.addEventListener('click', openSearchModal);
els.searchCancelBtn.addEventListener('click', closeSearchModal);
els.searchModal.addEventListener('click', (e) => {
  if (e.target === els.searchModal) closeSearchModal();
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

  const includeMr = els.includeMrCheckbox.checked;
  const gitlab = { projectId: '', projectName: '', sourceBranch: '', targetBranch: '' };
  if (includeMr) {
    // Un texto escrito solo vale si GitLab lo devuelve como nombre exacto.
    await Promise.all(gitlabCombos.map((combo) => combo.commitTyped()));
    const project = gitlabProjectCombo.selected;
    const source = gitlabSourceCombo.selected;
    const target = gitlabTargetCombo.selected;
    if (!project) {
      setGitlabMessage('Selecciona un proyecto de GitLab en la lista.', 'error');
      return;
    }
    if (!source || !target) {
      setGitlabMessage('Selecciona en la lista las ramas de origen y destino.', 'error');
      return;
    }
    gitlab.projectId = project.value;
    gitlab.projectName = project.label;
    gitlab.sourceBranch = source.value;
    gitlab.targetBranch = target.value;
  }

  els.copyDoBtn.disabled = true;
  setCopyMessage('Copiando y descargando archivos...', '');
  const result = await window.api.copyIssue(state.config, {
    issueKey: data.issue.key,
    sections,
    comments,
    includeMr,
    gitlab,
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
  if (includeMr) parts.push('diff de MR');
  let extra = '';
  if (result.failed) extra = ` (${result.failed} archivo(s) sin descargar)`;
  if (result.folder) extra += ` · Archivos en ${result.folder}`;
  setStatus(`Copiado al portapapeles: ${parts.join(', ')}.${extra}`, 'ok');
});

// ---------------------------------------------------------------------------
// Bandeja de incidencias
// ---------------------------------------------------------------------------

const BUG_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const BUG_MAX_IMAGES = 20;
const BUG_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const BUG_MAX_LINKS = 10;
const BUG_LINK_LABELS = { slack: 'Slack', jira: 'Jira', web: 'Web', otro: 'Enlace' };
const HOTKEY_PROMPT = 'Pulsa una combinacion...';

function setBugMessage(message, type) {
  els.bugMessage.textContent = message || '';
  els.bugMessage.className = 'form-message ' + (type || '');
}

function activeBugHotkeyLabel() {
  return hotkeyLabel((state.config && state.config.bugHotkey) || DEFAULT_BUG_HOTKEY);
}

function applyBugConfigToForm(config) {
  els.bugHotkey.value = hotkeyLabel((config && config.bugHotkey) || DEFAULT_BUG_HOTKEY);
  els.bugStartAtLogin.checked = Boolean(config && config.bugStartAtLogin);
}

// El campo es de solo lectura: la combinacion se captura pulsandola, no
// escribiendola, para no guardar texto que globalShortcut no acepta.
els.bugHotkey.addEventListener('focus', () => {
  els.bugHotkey.dataset.previous = els.bugHotkey.value;
  els.bugHotkey.value = HOTKEY_PROMPT;
});

els.bugHotkey.addEventListener('blur', () => {
  if (els.bugHotkey.value !== HOTKEY_PROMPT) return;
  els.bugHotkey.value = els.bugHotkey.dataset.previous || hotkeyLabel(DEFAULT_BUG_HOTKEY);
});

els.bugHotkey.addEventListener('keydown', (event) => {
  event.preventDefault();
  if (event.key === 'Escape') {
    els.bugHotkey.value = hotkeyLabel(DEFAULT_BUG_HOTKEY);
    setFormMessage('', '');
    return;
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].indexOf(event.key) !== -1) return;
  const parsed = acceleratorFromEvent(event);
  const accelerator = normalizeAccelerator(
    parsed.modifiers.concat(parsed.key).join('+')
  );
  if (!accelerator) {
    setFormMessage('Combina Ctrl, Alt o Shift con una letra, un digito o una tecla F.', 'error');
    return;
  }
  els.bugHotkey.value = hotkeyLabel(accelerator);
  setFormMessage('', '');
});

function findBug(id) {
  for (const item of state.bugs) {
    if (item.id === id) return item;
  }
  return null;
}

function replaceBug(item) {
  if (!item || !item.id) return;
  for (let index = 0; index < state.bugs.length; index++) {
    if (state.bugs[index].id === item.id) {
      state.bugs[index] = item;
      return;
    }
  }
  state.bugs.unshift(item);
}

function bugMatchesFilter(item, filter) {
  if (filter === 'pending') return item.state === 'new';
  if (filter === 'created') return item.state === 'created';
  return true;
}

function visibleBugs() {
  const term = state.bugSearch.trim().toLowerCase();
  return state.bugs.filter((item) => {
    if (!bugMatchesFilter(item, state.bugFilter)) return false;
    if (!term) return true;
    const haystack = [item.title, item.details, item.issueKey, item.jiraKey]
      .concat((item.links || []).map((link) => link.url))
      .join(' ')
      .toLowerCase();
    return haystack.indexOf(term) !== -1;
  });
}

function updateBugBadge() {
  let pending = 0;
  let created = 0;
  for (const item of state.bugs) {
    if (item.state === 'new') pending += 1;
    else if (item.state === 'created') created += 1;
  }
  els.bugCountPending.textContent = String(pending);
  els.bugCountCreated.textContent = String(created);
  els.bugCountAll.textContent = String(state.bugs.length);
  els.bugsCount.textContent = String(pending);
  els.bugsCount.classList.toggle('hidden', pending === 0);
}

function bugStatusLabel(value) {
  if (value === 'created') return 'Creada';
  if (value === 'archived') return 'Archivada';
  return 'Nueva';
}

function bugRow(item) {
  const li = document.createElement('li');
  li.className = 'bug-item' + (item.id === state.bugSelectedId ? ' active' : '');

  const title = document.createElement('span');
  title.className = 'bug-item-title';
  title.textContent = item.title;
  li.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'bug-item-meta';

  const badge = document.createElement('span');
  badge.className = 'bug-state bug-state-' + item.state;
  badge.textContent = bugStatusLabel(item.state);
  meta.appendChild(badge);

  if (item.jiraKey) {
    const key = document.createElement('span');
    key.textContent = item.jiraKey;
    meta.appendChild(key);
  }

  const when = document.createElement('span');
  when.textContent = formatDate(item.createdAt);
  meta.appendChild(when);

  if ((item.images || []).length) {
    const count = document.createElement('span');
    count.textContent = item.images.length + ' img';
    meta.appendChild(count);
  }

  li.appendChild(meta);
  li.addEventListener('click', () => selectBug(item.id));
  return li;
}

function renderBugList() {
  updateBugBadge();
  els.bugList.textContent = '';
  const items = visibleBugs();
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'bug-list-empty';
    li.textContent = state.bugs.length
      ? 'Ninguna incidencia coincide con el filtro.'
      : 'Sin incidencias. Pulsa ' + activeBugHotkeyLabel() + ' desde cualquier aplicacion.';
    els.bugList.appendChild(li);
    return;
  }
  for (const item of items) els.bugList.appendChild(bugRow(item));
}

function bugLinkKind(url) {
  const text = String(url || '').trim();
  if (!/^https?:\/\//i.test(text)) return 'otro';
  if (/\.slack\.com\/archives\//i.test(text)) return 'slack';
  if (/\/browse\/[A-Za-z][A-Za-z0-9_]*-\d+/i.test(text)) return 'jira';
  return 'web';
}

function renderBugLinks() {
  els.bugLinkChips.textContent = '';
  for (const link of state.bugLinks) {
    const chip = document.createElement('span');
    chip.className = 'chip';

    const kind = document.createElement('span');
    kind.className = 'chip-kind';
    kind.textContent = BUG_LINK_LABELS[link.kind] || 'Enlace';
    chip.appendChild(kind);

    const url = document.createElement('button');
    url.type = 'button';
    url.className = 'chip-url';
    url.textContent = link.url;
    if (/^https?:\/\//i.test(link.url)) {
      url.title = 'Abrir en el navegador';
      url.addEventListener('click', () => window.api.openExternal(link.url));
    }
    chip.appendChild(url);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chip-remove';
    remove.textContent = '✕';
    remove.title = 'Quitar enlace';
    remove.addEventListener('click', () => {
      state.bugLinks = state.bugLinks.filter((entry) => entry.url !== link.url);
      renderBugLinks();
    });
    chip.appendChild(remove);

    els.bugLinkChips.appendChild(chip);
  }
}

async function renderBugImages(item) {
  const images = item.images || [];
  els.bugImages.textContent = '';
  els.bugImagesEmpty.textContent = images.length ? '' : 'Sin imagenes.';
  els.bugImagesEmpty.classList.toggle('hidden', images.length > 0);
  els.bugAddImageBtn.disabled = images.length >= BUG_MAX_IMAGES;

  for (const filename of images) {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.title = filename;

    const img = document.createElement('img');
    img.alt = filename;
    const loaded = await window.api.readBugImage(item.id, filename);
    if (loaded && loaded.ok) img.src = loaded.dataUrl;
    thumb.appendChild(img);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'thumb-remove';
    remove.textContent = '✕';
    remove.title = 'Quitar imagen';
    remove.addEventListener('click', async () => {
      const result = await window.api.deleteBugImage(item.id, filename);
      if (!result || !result.ok) {
        setBugMessage('Error: ' + ((result && result.error) || 'desconocido'), 'error');
        return;
      }
      replaceBug(result.item);
      renderBugList();
      await renderBugImages(result.item);
      setBugMessage('Imagen eliminada.', 'ok');
    });
    thumb.appendChild(remove);

    els.bugImages.appendChild(thumb);
  }
}

function bugWebUrl(key) {
  if (!key || !state.config || !state.config.baseUrl) return '';
  return normalizeBaseUrl(state.config.baseUrl) + '/browse/' + key;
}

function renderBugFooter(item) {
  const created = item.state === 'created';
  const archived = item.state === 'archived';

  els.bugCreatedRow.classList.toggle('hidden', created || archived);
  els.bugMeta.textContent =
    'Capturada ' +
    (formatDate(item.createdAt) || 'sin fecha') +
    (item.issueKey ? ' · Issue ' + item.issueKey : '') +
    ' · ' +
    item.id;
  els.bugArchiveBtn.textContent = archived ? 'Restaurar' : 'Archivar';
  els.bugDeleteBtn.textContent = state.bugDeleteArmed ? 'Confirmar eliminacion' : 'Eliminar';

  els.bugCreatedInfo.textContent = '';
  els.bugCreatedInfo.classList.toggle('hidden', !created);
  if (!created) return;

  const label = document.createElement('span');
  label.textContent =
    'Creada' + (item.createdJiraAt ? ' el ' + formatDate(item.createdJiraAt) : '') + ':';
  els.bugCreatedInfo.appendChild(label);

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'chip-url';
  link.textContent = item.jiraKey;
  const url = bugWebUrl(item.jiraKey);
  if (url) {
    link.title = 'Abrir en Jira';
    link.addEventListener('click', () => window.api.openExternal(url));
  }
  els.bugCreatedInfo.appendChild(link);

  const reopen = document.createElement('button');
  reopen.type = 'button';
  reopen.className = 'btn btn-ghost';
  reopen.textContent = 'Reabrir';
  reopen.addEventListener('click', () =>
    patchBug(item.id, { state: 'new' }, 'Incidencia reabierta.')
  );
  els.bugCreatedInfo.appendChild(reopen);
}

async function selectBug(id) {
  state.bugSelectedId = id;
  state.bugDeleteArmed = false;
  const item = findBug(id);
  renderBugList();
  if (!item) return;

  els.bugEmpty.classList.add('hidden');
  els.bugDetailBody.classList.remove('hidden');
  els.bugTitleInput.value = item.title || '';
  els.bugDetailsInput.value = item.details || '';
  els.bugIssueInput.value = item.issueKey || '';
  els.bugJiraKeyInput.value = item.jiraKey || '';
  state.bugLinks = (item.links || []).map((link) => ({ url: link.url, kind: link.kind }));
  renderBugLinks();
  renderBugFooter(item);
  setBugMessage('');
  await renderBugImages(item);
}

function showNoBugSelected(message) {
  state.bugSelectedId = null;
  state.bugDeleteArmed = false;
  els.bugDetailBody.classList.add('hidden');
  els.bugEmpty.classList.remove('hidden');
  els.bugEmpty.textContent = message || 'Selecciona una incidencia.';
}

async function patchBug(id, changes, successMessage) {
  if (!id) return null;
  const result = await window.api.updateBug(id, changes);
  if (!result || !result.ok) {
    setBugMessage('Error: ' + ((result && result.error) || 'desconocido'), 'error');
    return null;
  }
  replaceBug(result.item);
  renderBugList();
  if (result.item.id === state.bugSelectedId) renderBugFooter(result.item);
  if (successMessage) setBugMessage(successMessage, 'ok');
  return result.item;
}

async function loadBugs() {
  const result = await window.api.listBugs();
  if (!result || !result.ok) {
    updateBugBadge();
    if (result && result.error) setBugMessage('Error: ' + result.error, 'error');
    return;
  }
  state.bugs = result.items || [];
  renderBugList();
  if (state.bugSelectedId && !findBug(state.bugSelectedId)) showNoBugSelected();
}

function openBugsModal() {
  els.bugsModal.classList.remove('hidden');
  loadBugs();
  if (!state.bugSelectedId) showNoBugSelected();
}

function closeBugsModal() {
  els.bugsModal.classList.add('hidden');
}

function addBugLinkFromInput() {
  const text = els.bugLinkInput.value.trim();
  if (!text) return;
  els.bugLinkInput.value = '';
  if (state.bugLinks.some((link) => link.url === text)) return;
  if (state.bugLinks.length >= BUG_MAX_LINKS) {
    setBugMessage('Cada incidencia admite como maximo ' + BUG_MAX_LINKS + ' enlaces.', 'error');
    return;
  }
  state.bugLinks.push({ url: text, kind: bugLinkKind(text) });
  renderBugLinks();
  setBugMessage('Pulsa "Guardar cambios" para conservar el enlace.', '');
}

els.bugsBtn.addEventListener('click', openBugsModal);
els.bugsCloseBtn.addEventListener('click', closeBugsModal);
els.bugsModal.addEventListener('click', (event) => {
  if (event.target === els.bugsModal) closeBugsModal();
});
els.bugNewBtn.addEventListener('click', () => window.api.openBugCapture());
els.bugSearch.addEventListener('input', () => {
  state.bugSearch = els.bugSearch.value;
  renderBugList();
});
els.bugAddLinkBtn.addEventListener('click', addBugLinkFromInput);
els.bugLinkInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addBugLinkFromInput();
  }
});
els.bugSaveBtn.addEventListener('click', async () => {
  const item = await patchBug(
    state.bugSelectedId,
    {
      title: els.bugTitleInput.value,
      details: els.bugDetailsInput.value,
      links: state.bugLinks,
      issueKey: els.bugIssueInput.value,
    },
    'Cambios guardados.'
  );
  if (!item) return;
  els.bugTitleInput.value = item.title;
  els.bugIssueInput.value = item.issueKey;
});
els.bugMarkCreatedBtn.addEventListener('click', () => {
  patchBug(
    state.bugSelectedId,
    { state: 'created', jiraKey: els.bugJiraKeyInput.value },
    'Marcada como creada.'
  );
});
els.bugAddImageBtn.addEventListener('click', () => {
  if (typeof els.bugImageInput.click === 'function') els.bugImageInput.click();
});
els.bugImageInput.addEventListener('change', async () => {
  const files = Array.from(els.bugImageInput.files || []);
  const selected = state.bugSelectedId;
  if (!files.length || !selected) return;
  let added = 0;
  let rejected = 0;
  for (const file of files) {
    const current = findBug(selected);
    if (!current) break;
    if (
      BUG_IMAGE_TYPES.indexOf(file.type) === -1 ||
      file.size > BUG_MAX_IMAGE_BYTES ||
      (current.images || []).length >= BUG_MAX_IMAGES
    ) {
      rejected += 1;
      continue;
    }
    const bytes = await file.arrayBuffer();
    const result = await window.api.addBugImage(selected, { type: file.type, bytes });
    if (!result || !result.ok) {
      rejected += 1;
      continue;
    }
    replaceBug(result.item);
    added += 1;
  }
  const item = findBug(selected);
  renderBugList();
  if (item) await renderBugImages(item);
  const parts = [];
  if (added) parts.push(added + ' imagen(es) anadidas');
  if (rejected) parts.push(rejected + ' archivo(s) descartados');
  setBugMessage(
    parts.join(' · ') || 'Ningun archivo es una imagen valida.',
    parts.length ? 'ok' : 'error'
  );
});
els.bugCopyMdBtn.addEventListener('click', async () => {
  if (!state.bugSelectedId) return;
  const result = await window.api.copyBugMarkdown(state.bugSelectedId);
  if (!result || !result.ok) {
    setBugMessage('Error: ' + ((result && result.error) || 'desconocido'), 'error');
    return;
  }
  setBugMessage('Markdown copiado (' + result.chars + ' caracteres).', 'ok');
});
els.bugCopyPathsBtn.addEventListener('click', async () => {
  if (!state.bugSelectedId) return;
  const result = await window.api.copyBugImagePaths(state.bugSelectedId);
  if (!result || !result.ok) {
    setBugMessage('Error: ' + ((result && result.error) || 'desconocido'), 'error');
    return;
  }
  setBugMessage('Rutas de ' + result.count + ' imagen(es) copiadas.', 'ok');
});
els.bugOpenFolderBtn.addEventListener('click', async () => {
  if (!state.bugSelectedId) return;
  const result = await window.api.openBugFolder(state.bugSelectedId);
  if (!result || !result.ok) {
    setBugMessage('Error: ' + ((result && result.error) || 'desconocido'), 'error');
  }
});
els.bugArchiveBtn.addEventListener('click', async () => {
  const item = findBug(state.bugSelectedId);
  if (!item) return;
  if (item.state === 'archived') {
    await patchBug(item.id, { state: item.jiraKey ? 'created' : 'new' }, 'Incidencia restaurada.');
    return;
  }
  await patchBug(item.id, { state: 'archived' }, 'Incidencia archivada.');
});
els.bugDeleteBtn.addEventListener('click', async () => {
  const id = state.bugSelectedId;
  if (!id) return;
  if (!state.bugDeleteArmed) {
    state.bugDeleteArmed = true;
    els.bugDeleteBtn.textContent = 'Confirmar eliminacion';
    setBugMessage('Se borra tambien la carpeta con las imagenes. Pulsa otra vez para confirmar.', 'error');
    return;
  }
  const result = await window.api.deleteBug(id);
  state.bugDeleteArmed = false;
  if (!result || !result.ok) {
    els.bugDeleteBtn.textContent = 'Eliminar';
    setBugMessage('Error: ' + ((result && result.error) || 'desconocido'), 'error');
    return;
  }
  state.bugs = state.bugs.filter((item) => item.id !== id);
  showNoBugSelected();
  renderBugList();
  setBugMessage('Incidencia eliminada.', 'ok');
});

const bugFilterTabs = [
  { node: els.bugTabPending, filter: 'pending' },
  { node: els.bugTabCreated, filter: 'created' },
  { node: els.bugTabAll, filter: 'all' },
];
for (const entry of bugFilterTabs) {
  entry.node.addEventListener('click', () => {
    state.bugFilter = entry.filter;
    for (const other of bugFilterTabs) {
      other.node.classList.toggle('active', other === entry);
    }
    renderBugList();
  });
}

// Las capturas hechas mientras la ventana estaba oculta se ven al volver: el
// contador tiene que reflejarlas aunque la modal este cerrada.
if (typeof window.addEventListener === 'function') {
  window.addEventListener('focus', () => loadBugs());
}

async function init() {
  const config = await window.api.getConfig();
  loadBugs();
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
