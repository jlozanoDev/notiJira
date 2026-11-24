const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_LINKS = 10;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const els = {
  title: document.getElementById('titleInput'),
  titleError: document.getElementById('titleError'),
  details: document.getElementById('detailsInput'),
  link: document.getElementById('linkInput'),
  addLinkBtn: document.getElementById('addLinkBtn'),
  linkChips: document.getElementById('linkChips'),
  linkError: document.getElementById('linkError'),
  issue: document.getElementById('issueInput'),
  dropZone: document.getElementById('dropZone'),
  imageStrip: document.getElementById('imageStrip'),
  dropHint: document.getElementById('dropHint'),
  imageInput: document.getElementById('imageInput'),
  imageError: document.getElementById('imageError'),
  status: document.getElementById('statusText'),
  saveBtn: document.getElementById('saveBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  closeBtn: document.getElementById('closeBtn'),
};

const state = {
  links: [],
  images: [],
  saving: false,
};

function setStatus(text, isError) {
  els.status.textContent = text || 'Enter guarda · Ctrl+Enter guarda · Esc cierra';
  els.status.classList.toggle('error', Boolean(isError));
}

function showError(element, text) {
  element.textContent = text || '';
  element.classList.toggle('hidden', !text);
}

// Mismo criterio que main.js: el origen del enlace decide la etiqueta.
function classifyLink(url) {
  const text = String(url || '').trim();
  if (!/^https?:\/\//i.test(text)) return { url: text, kind: 'otro' };
  if (/\.slack\.com\/archives\//i.test(text)) return { url: text, kind: 'slack' };
  if (/\/browse\/[A-Za-z][A-Za-z0-9_]*-\d+/i.test(text)) return { url: text, kind: 'jira' };
  return { url: text, kind: 'web' };
}

function linkLabel(kind) {
  if (kind === 'slack') return 'Slack';
  if (kind === 'jira') return 'Jira';
  if (kind === 'web') return 'Web';
  return 'Enlace';
}

function issueKeyFromLink(url) {
  const match = String(url || '').match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/i);
  return match ? match[1].toUpperCase() : '';
}

function pushLink(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) return false;
  if (state.links.some((link) => link.url === text)) return false;
  if (state.links.length >= MAX_LINKS) {
    showError(els.linkError, `Maximo ${MAX_LINKS} enlaces por incidencia.`);
    return false;
  }
  const link = classifyLink(text);
  state.links.push(link);
  if (link.kind === 'jira' && !els.issue.value.trim()) {
    els.issue.value = issueKeyFromLink(link.url);
  }
  showError(els.linkError, '');
  renderLinks();
  return true;
}

function removeLink(url) {
  state.links = state.links.filter((link) => link.url !== url);
  renderLinks();
}

function renderLinks() {
  els.linkChips.textContent = '';
  for (const link of state.links) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.title = link.url;

    const kind = document.createElement('span');
    kind.className = 'chip-kind';
    kind.textContent = linkLabel(link.kind);

    const url = document.createElement('span');
    url.className = 'chip-url';
    url.textContent = link.url;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chip-remove';
    remove.textContent = '✕';
    remove.title = 'Quitar enlace';
    remove.addEventListener('click', () => removeLink(link.url));

    chip.append(kind, url, remove);
    els.linkChips.append(chip);
  }
}

function renderImages() {
  els.imageStrip.textContent = '';
  els.dropZone.classList.toggle('has-images', state.images.length > 0);
  els.dropHint.textContent = state.images.length
    ? `${state.images.length}/${MAX_IMAGES} imagenes · suelta mas o pega con Ctrl+V`
    : 'Arrastra imagenes aqui';

  for (const image of state.images) {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.title = image.name || 'Imagen';

    const preview = document.createElement('img');
    preview.src = image.objectUrl;
    preview.alt = '';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'thumb-remove';
    remove.textContent = '✕';
    remove.title = 'Quitar imagen';
    remove.addEventListener('click', () => removeImage(image));

    thumb.append(preview, remove);
    els.imageStrip.append(thumb);
  }
}

function removeImage(image) {
  state.images = state.images.filter((item) => item !== image);
  URL.revokeObjectURL(image.objectUrl);
  showError(els.imageError, '');
  renderImages();
}

async function addFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  let rejected = 0;
  let overflow = 0;

  for (const file of list) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      rejected += 1;
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      rejected += 1;
      continue;
    }
    if (state.images.length >= MAX_IMAGES) {
      overflow += 1;
      continue;
    }
    const bytes = await file.arrayBuffer();
    state.images.push({
      name: file.name || '',
      type: file.type,
      bytes,
      objectUrl: URL.createObjectURL(file),
    });
  }

  const messages = [];
  if (rejected) {
    messages.push(
      (rejected === 1 ? 'Se descarto 1 archivo' : `Se descartaron ${rejected} archivos`) +
        ': solo PNG, JPG, GIF o WebP de hasta 10 MB.'
    );
  }
  if (overflow) messages.push(`Cada incidencia admite como maximo ${MAX_IMAGES} imagenes.`);
  showError(els.imageError, messages.join(' '));
  renderImages();
}

// Cualquier archivo pegado se pasa al validador: si el formato no vale hay que
// decirlo, no ignorarlo en silencio.
function fileFromClipboard(clipboardData) {
  if (!clipboardData) return [];
  const files = [];
  for (const item of Array.from(clipboardData.items || [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

async function save() {
  if (state.saving) return;
  const title = els.title.value.trim();
  if (!title) {
    showError(els.titleError, 'Escribe un titulo para guardar.');
    els.title.focus();
    return;
  }
  showError(els.titleError, '');

  state.saving = true;
  els.saveBtn.disabled = true;
  setStatus('Guardando...');

  const result = await window.api.createBug({
    title,
    details: els.details.value,
    links: state.links,
    issueKey: els.issue.value,
    images: state.images.map((image) => ({ type: image.type, bytes: image.bytes })),
  });

  state.saving = false;
  els.saveBtn.disabled = false;

  if (!result || !result.ok) {
    setStatus((result && result.error) || 'No se pudo guardar la incidencia.', true);
    return;
  }

  await window.api.clearBugDraft();
  await window.api.closeBugCapture();
}

async function closeWithDraft() {
  if (state.saving) return;
  await window.api.saveBugDraft({
    title: els.title.value,
    details: els.details.value,
    links: state.links,
    issueKey: els.issue.value,
  });
  await window.api.closeBugCapture();
}

function resetImages() {
  for (const image of state.images) URL.revokeObjectURL(image.objectUrl);
  state.images = [];
  els.imageInput.value = '';
}

async function refresh() {
  resetImages();
  state.links = [];
  els.title.value = '';
  els.details.value = '';
  els.issue.value = '';
  els.link.value = '';
  showError(els.titleError, '');
  showError(els.linkError, '');
  showError(els.imageError, '');
  setStatus('');

  const [draftResult, contextResult] = await Promise.all([
    window.api.getBugDraft(),
    window.api.getBugContext(),
  ]);

  const draft = draftResult && draftResult.ok ? draftResult.draft : null;
  const context = contextResult && contextResult.ok ? contextResult : {};

  const hasDraft =
    draft &&
    (String(draft.title || '').trim() ||
      String(draft.details || '').trim() ||
      (draft.links || []).length ||
      String(draft.issueKey || '').trim());

  if (hasDraft) {
    els.title.value = draft.title || '';
    els.details.value = draft.details || '';
    els.issue.value = draft.issueKey || '';
    for (const link of draft.links || []) pushLink(link.url || link);
    setStatus('Borrador recuperado');
  } else {
    els.issue.value = context.issueKey || '';
    if (context.clipboardUrl) pushLink(context.clipboardUrl);
    setStatus('');
  }

  renderLinks();
  renderImages();
  els.title.focus();
  els.title.select();
}

els.title.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    save();
  }
});

els.link.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (pushLink(els.link.value)) els.link.value = '';
  }
});

els.addLinkBtn.addEventListener('click', () => {
  if (pushLink(els.link.value)) {
    els.link.value = '';
    els.link.focus();
  }
});

els.saveBtn.addEventListener('click', () => save());
els.cancelBtn.addEventListener('click', () => closeWithDraft());
els.closeBtn.addEventListener('click', () => closeWithDraft());

els.dropZone.addEventListener('click', (event) => {
  if (event.target.closest('.thumb')) return;
  els.imageInput.click();
});

els.imageInput.addEventListener('change', async () => {
  await addFiles(els.imageInput.files);
  els.imageInput.value = '';
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeWithDraft();
    return;
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    save();
  }
});

document.addEventListener('paste', async (event) => {
  const files = fileFromClipboard(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  await addFiles(files);
});

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragging');
  });
}

document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget) return;
  els.dropZone.classList.remove('dragging');
});

document.addEventListener('drop', async (event) => {
  event.preventDefault();
  els.dropZone.classList.remove('dragging');
  const files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length) await addFiles(files);
});

window.api.onShown(() => refresh());
refresh();
