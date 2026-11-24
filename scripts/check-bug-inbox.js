'use strict';
// Headless regression checks for the bug inbox (captura rapida de incidencias).
// Run with: npm run check:bugs   (node + assert, no test framework).
const Module = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const stubPath = path.join(__dirname, 'test-support', 'electron-stub.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return stubPath;
  return origResolve.call(this, request, parent, ...rest);
};
const stub = require(stubPath);
const { createHarness } = require(path.join(__dirname, 'test-support', 'renderer-stub.js'));

const PNG = Buffer.from('fake-png-bytes');
const BIG = Buffer.alloc(11 * 1024 * 1024, 7);
const SLACK_URL = 'https://acme.slack.com/archives/C0123/p1700000000123456';
const JIRA_URL = 'https://jira.example/browse/CLIN-530';
const WEB_URL = 'https://example.com/doc';

const toArrayBuffer = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const imagePayload = (type, buffer) => ({ type, bytes: toArrayBuffer(buffer) });
const clone = (value) => JSON.parse(JSON.stringify(value));

const configFilePath = () => path.join(stub.__userData, 'config.json');
const storedConfig = () => JSON.parse(fs.readFileSync(configFilePath(), 'utf8'));
const bugFile = (id, name) => path.join(stub.__userData, 'bugs', id, name);
const baseConfig = { baseUrl: 'https://jira.example', apiToken: 'tok', email: '' };

// Queda constancia de cualquier peticion: la bandeja no debe escribir fuera.
let fetched = [];
global.fetch = async (url, options) => {
  const target = String(url);
  fetched.push({ url: target, method: (options && options.method) || 'GET' });
  const body = /\/comment/.test(target)
    ? { comments: [], total: 0 }
    : /\/browse\/|\/issue\//.test(target)
      ? {
          key: 'CLIN-530',
          id: '10001',
          self: target,
          fields: {
            summary: 'Resumen',
            status: { name: 'Abierta' },
            issuetype: { name: 'Tarea' },
            created: '2026-11-20T10:00:00.000Z',
            updated: '2026-11-20T10:00:00.000Z',
            description: { type: 'doc', version: 1, content: [] },
          },
        }
      : {};
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
};

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

// --------------------------------------------------------------------------
// Ajustes: atajo global y arranque con Windows (S7, S8, S10)
// --------------------------------------------------------------------------

check('S7 S8 guardar ajustes normaliza el atajo y lo registra', async (h) => {
  const res = await h['config:save'](null, { ...baseConfig, bugHotkey: 'ctrl+alt+j' });
  assert.equal(res.ok, true, 'el guardado debe ser correcto');
  assert.equal(storedConfig().bugHotkey, 'Control+Alt+J');
  assert.equal(stub.__shortcuts.isRegistered('Control+Alt+J'), true);
  const got = await h['config:get']();
  assert.equal(got.bugHotkey, 'Control+Alt+J');
  assert.equal(got.bugShortcutActive, true);
});

check('S8 sin atajo guardado config:get devuelve el predeterminado', async (h) => {
  await h['config:save'](null, baseConfig);
  const got = await h['config:get']();
  assert.equal(got.bugHotkey, 'Control+Alt+J');
  assert.equal(got.bugStartAtLogin, false);
});

check('S7 un atajo sin modificador no borra lo guardado', async (h) => {
  await h['config:save'](null, { ...baseConfig, bugHotkey: 'Control+Alt+K' });
  const before = fs.readFileSync(configFilePath(), 'utf8');
  const res = await h['config:save'](null, {
    baseUrl: 'https://otro.example',
    apiToken: 'tok',
    bugHotkey: 'J',
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /no es valido/);
  assert.equal(fs.readFileSync(configFilePath(), 'utf8'), before, 'config.json intacto');
});

check('S7 si el registro falla se conserva y sigue activo el anterior', async (h) => {
  await h['config:save'](null, { ...baseConfig, bugHotkey: 'Control+Alt+J' });
  stub.__setShortcutFailure('Control+Alt+Shift+B');
  const res = await h['config:save'](null, { ...baseConfig, bugHotkey: 'Control+Alt+Shift+B' });
  assert.equal(res.ok, true, 'los demas ajustes si se guardan');
  assert.match(res.hotkeyError, /No se pudo registrar Ctrl\+Alt\+Shift\+B/);
  assert.equal(stub.__shortcuts.isRegistered('Control+Alt+J'), true, 'el anterior sigue activo');
  assert.equal(stub.__shortcuts.isRegistered('Control+Alt+Shift+B'), false);
  assert.equal(storedConfig().bugHotkey, 'Control+Alt+J');
  assert.equal((await h['config:get']()).bugShortcutActive, true);
});

check('S7 cambiar el atajo libera el anterior', async (h) => {
  await h['config:save'](null, { ...baseConfig, bugHotkey: 'Control+Alt+J' });
  await h['config:save'](null, { ...baseConfig, bugHotkey: 'Control+Alt+K' });
  assert.equal(stub.__shortcuts.isRegistered('Control+Alt+J'), false);
  assert.equal(stub.__shortcuts.isRegistered('Control+Alt+K'), true);
});

check('S8 un guardado parcial conserva atajo y arranque', async (h) => {
  await h['config:save'](null, {
    ...baseConfig,
    bugHotkey: 'Control+Alt+K',
    bugStartAtLogin: true,
  });
  const res = await h['config:save'](null, { baseUrl: 'https://otro.example', apiToken: 'tok' });
  assert.equal(res.ok, true);
  const stored = storedConfig();
  assert.equal(stored.baseUrl, 'https://otro.example');
  assert.equal(stored.bugHotkey, 'Control+Alt+K');
  assert.equal(stored.bugStartAtLogin, true);
});

check('S10 arrancar con Windows solo se aplica empaquetado', async (h) => {
  assert.equal(stub.app.isPackaged, false, 'el stub no esta empaquetado');
  await h['config:save'](null, { ...baseConfig, bugStartAtLogin: true });
  assert.equal(storedConfig().bugStartAtLogin, true, 'el valor si se guarda');
  assert.equal(stub.__loginCalls.length, 0, 'pero no se toca el registro');
  stub.app.isPackaged = true;
  try {
    await h['config:save'](null, { ...baseConfig, bugStartAtLogin: true });
    assert.deepEqual(stub.__loginCalls, [{ openAtLogin: true }]);
  } finally {
    stub.app.isPackaged = false;
  }
});

// --------------------------------------------------------------------------
// Atajo global y ventana de captura (S1, S7)
// --------------------------------------------------------------------------

check('S1 el atajo abre la ventana de captura sin reiniciarla', async (h) => {
  await h['config:save'](null, { ...baseConfig, bugHotkey: 'Control+Alt+J' });
  const shortcut = stub.__shortcuts.callbacks['Control+Alt+J'];
  assert.equal(typeof shortcut, 'function', 'el atajo queda asociado a la captura');
  shortcut();
  const win = stub.__windows[stub.__windows.length - 1];
  assert.ok(win, 'se crea una ventana propia');
  assert.equal(win.options.frame, false);
  assert.equal(win.options.alwaysOnTop, true, 'visible desde cualquier aplicacion');
  assert.equal(win.options.skipTaskbar, true);
  assert.equal(win.isVisible(), true);

  win.sent.length = 0;
  shortcut();
  assert.deepEqual(win.sent, [], 'con la ventana visible no se reinicia lo escrito');

  await h['bugs:close']();
  assert.equal(win.isVisible(), false);
  shortcut();
  assert.equal(win.sent.length, 1);
  assert.equal(win.sent[0].channel, 'capture:shown');
});

check('S7 al salir se liberan los atajos globales', async (h) => {
  await h['config:save'](null, { ...baseConfig, bugHotkey: 'Control+Alt+J' });
  assert.equal(stub.__shortcuts.isRegistered('Control+Alt+J'), true);
  assert.ok((stub.__appListeners['will-quit'] || []).length, 'main.js escucha will-quit');
  stub.__fire('will-quit');
  assert.equal(stub.__shortcuts.isRegistered('Control+Alt+J'), false);
});

// --------------------------------------------------------------------------
// Almacenamiento local (S2, S3, S4, S6, S12, S14)
// --------------------------------------------------------------------------

check('S2 S14 crear una incidencia exige titulo y escribe nota.json', async (h) => {
  const empty = await h['bugs:create'](null, { title: '   ' });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /titulo/);

  const res = await h['bugs:create'](null, { title: '  Boton roto  ', details: 'Al pulsar' });
  assert.equal(res.ok, true);
  assert.match(res.item.id, /^b-\d{14}-[0-9a-f]{4}$/);
  assert.equal(res.item.title, 'Boton roto');
  assert.equal(res.item.state, 'new');
  assert.equal(res.item.jiraKey, '');
  const onDisk = JSON.parse(fs.readFileSync(bugFile(res.item.id, 'nota.json'), 'utf8'));
  assert.equal(onDisk.title, 'Boton roto');
});

check('S14 los campos se recortan a los limites', async (h) => {
  const res = await h['bugs:create'](null, {
    title: 'x'.repeat(400),
    details: 'y'.repeat(30000),
  });
  assert.equal(res.item.title.length, 300);
  assert.equal(res.item.details.length, 20000);
});

check('S6 los enlaces se clasifican por su origen y no se repiten', async (h) => {
  const res = await h['bugs:create'](null, {
    title: 'Enlaces',
    links: [SLACK_URL, JIRA_URL, WEB_URL, 'archivo.zip', SLACK_URL],
  });
  assert.deepEqual(
    res.item.links.map((link) => link.kind),
    ['slack', 'jira', 'web', 'otro']
  );
  const eleven = await h['bugs:create'](null, {
    title: 'Demasiados',
    links: Array.from({ length: 12 }, (unused, i) => `${WEB_URL}?i=${i}`),
  });
  assert.equal(eleven.item.links.length, 10);
});

check('S6 una URL de Jira rellena el issue relacionado', async (h) => {
  const res = await h['bugs:create'](null, { title: 'Issue', issueKey: JIRA_URL });
  assert.equal(res.item.issueKey, 'CLIN-530');
  const lower = await h['bugs:create'](null, { title: 'Minuscula', issueKey: 'clin-9' });
  assert.equal(lower.item.issueKey, 'CLIN-9');
  const junk = await h['bugs:create'](null, { title: 'Basura', issueKey: 'no-es-clave' });
  assert.equal(junk.item.issueKey, '');
});

check('S3 S14 imagenes: formato, tamano y limite por incidencia', async (h) => {
  const res = await h['bugs:create'](null, {
    title: 'Imagenes',
    images: [
      imagePayload('image/png', PNG),
      imagePayload('image/bmp', PNG),
      imagePayload('image/png', BIG),
    ],
  });
  assert.equal(res.ok, true);
  assert.equal(res.failed, 2, 'formato no soportado y tamano excesivo se descartan');
  assert.deepEqual(res.item.images, ['img-1.png']);
  assert.equal(fs.existsSync(bugFile(res.item.id, 'img-1.png')), true);

  const many = await h['bugs:create'](null, {
    title: 'Muchas',
    images: Array.from({ length: 21 }, (unused, index) =>
      imagePayload(index % 2 ? 'image/jpeg' : 'image/png', PNG)
    ),
  });
  assert.equal(many.item.images.length, 20);

  const overflow = await h['bugs:image:add'](null, {
    id: many.item.id,
    image: imagePayload('image/png', PNG),
  });
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, /maximo 20/);
  assert.equal(fs.existsSync(bugFile(many.item.id, 'img-21.png')), false, 'no se escribe nada');
});

check('S14 leer una imagen devuelve data URL y rechaza rutas ajenas', async (h) => {
  const res = await h['bugs:create'](null, {
    title: 'Leer',
    images: [imagePayload('image/jpeg', PNG)],
  });
  const read = await h['bugs:image:read'](null, { id: res.item.id, filename: 'img-1.jpg' });
  assert.equal(read.ok, true);
  assert.match(read.dataUrl, /^data:image\/jpeg;base64,/);

  const badId = await h['bugs:image:read'](null, { id: '../../config', filename: 'config.json' });
  assert.equal(badId.ok, false, 'un id ajeno no lee el config');
  const badName = await h['bugs:image:read'](null, {
    id: res.item.id,
    filename: '../config.json',
  });
  assert.equal(badName.ok, false, 'un nombre con traversal no sale de la carpeta');
});

check('S12 borrar una imagen quita el archivo y la entrada', async (h) => {
  const res = await h['bugs:create'](null, { title: 'Borrar img', images: [imagePayload('image/png', PNG)] });
  const del = await h['bugs:image:delete'](null, { id: res.item.id, filename: 'img-1.png' });
  assert.equal(del.ok, true);
  assert.deepEqual(del.item.images, []);
  assert.equal(fs.existsSync(bugFile(res.item.id, 'img-1.png')), false);
  const again = await h['bugs:image:delete'](null, { id: res.item.id, filename: 'img-1.png' });
  assert.equal(again.ok, true, 'borrar dos veces no falla');
});

check('S11 listar ordena por fecha e ignora una carpeta corrupta', async (h) => {
  const first = await h['bugs:create'](null, { title: 'Primera' });
  const second = await h['bugs:create'](null, { title: 'Segunda' });
  const notePath = bugFile(first.item.id, 'nota.json');
  const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));
  note.createdAt = '2020-01-01T00:00:00.000Z';
  fs.writeFileSync(notePath, JSON.stringify(note));
  fs.writeFileSync(path.join(stub.__userData, 'bugs', 'suelto.txt'), 'x');
  const broken = path.join(stub.__userData, 'bugs', 'b-20200101000000-ffff');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'nota.json'), '{ no es json');

  const list = await h['bugs:list']();
  assert.deepEqual(
    list.items.map((item) => item.title),
    ['Segunda', 'Primera']
  );
});

check('S12 editar la incidencia normaliza los campos', async (h) => {
  const created = await h['bugs:create'](null, { title: 'Editar' });
  const res = await h['bugs:update'](null, {
    id: created.item.id,
    changes: {
      title: '  Editado  ',
      details: 'nuevo',
      issueKey: JIRA_URL,
      links: [SLACK_URL],
      state: 'archived',
    },
  });
  assert.equal(res.item.title, 'Editado');
  assert.equal(res.item.details, 'nuevo');
  assert.equal(res.item.issueKey, 'CLIN-530');
  assert.equal(res.item.state, 'archived');
  assert.deepEqual(res.item.links.map((link) => link.kind), ['slack']);
  const badState = await h['bugs:update'](null, {
    id: created.item.id,
    changes: { state: 'wip' },
  });
  assert.equal(badState.ok, false);
  const noTitle = await h['bugs:update'](null, {
    id: created.item.id,
    changes: { title: '   ' },
  });
  assert.equal(noTitle.ok, false);
});

check('S13 marcar como creada valida la clave y sale de pendientes', async (h) => {
  const created = await h['bugs:create'](null, { title: 'Flaky' });
  const missing = await h['bugs:update'](null, {
    id: created.item.id,
    changes: { state: 'created' },
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Escribe la clave/);
  assert.equal((await h['bugs:list']()).items[0].state, 'new', 'nada cambia');

  const invalid = await h['bugs:update'](null, {
    id: created.item.id,
    changes: { state: 'created', jiraKey: '530-CLIN' },
  });
  assert.equal(invalid.ok, false);

  const fromUrl = await h['bugs:update'](null, {
    id: created.item.id,
    changes: { state: 'created', jiraKey: JIRA_URL },
  });
  assert.equal(fromUrl.ok, true);
  assert.equal(fromUrl.item.jiraKey, 'CLIN-530');
  assert.equal(fromUrl.item.state, 'created');
  assert.ok(fromUrl.item.createdJiraAt, 'se registra cuando');
  assert.equal((await h['bugs:list']()).items.filter((item) => item.state === 'new').length, 0);

  const reopened = await h['bugs:update'](null, {
    id: created.item.id,
    changes: { state: 'new' },
  });
  assert.equal(reopened.item.jiraKey, '');
  assert.equal(reopened.item.createdJiraAt, null);
});

check('S12 el markdown resume la incidencia', async (h) => {
  const created = await h['bugs:create'](null, {
    title: 'Boton  roto',
    details: 'Linea 1\nLinea 2',
    links: [SLACK_URL],
    images: [imagePayload('image/png', PNG)],
  });
  await h['bugs:update'](null, {
    id: created.item.id,
    changes: { state: 'created', jiraKey: 'CLIN-530' },
  });
  const md = await h['bugs:markdown'](null, { id: created.item.id });
  assert.equal(md.ok, true);
  assert.match(md.markdown, /^# Boton  roto/);
  assert.match(md.markdown, /- Estado: Creada/);
  assert.match(md.markdown, /- Creada en Jira: CLIN-530/);
  assert.match(md.markdown, /## Detalles\n\nLinea 1\nLinea 2/);
  assert.match(md.markdown, new RegExp(`- Slack: ${SLACK_URL.replace(/\//g, '\\/')}`));
  assert.match(md.markdown, /img-1\.png/);
});

check('S12 copiar markdown y rutas escribe en el portapapeles', async (h) => {
  const withImage = await h['bugs:create'](null, {
    title: 'Clipboard',
    images: [imagePayload('image/png', PNG)],
  });
  const md = await h['bugs:copyMarkdown'](null, { id: withImage.item.id });
  assert.equal(md.ok, true);
  assert.match(stub.__getClipboard(), /^# Clipboard/);
  assert.ok(md.chars > 0);

  const paths = await h['bugs:copyImagePaths'](null, { id: withImage.item.id });
  assert.equal(paths.ok, true);
  assert.equal(paths.count, 1);
  assert.match(stub.__getClipboard(), new RegExp(`bugs/${withImage.item.id}/img-1\\.png`));

  const noImages = await h['bugs:create'](null, { title: 'Sin imagenes' });
  const fail = await h['bugs:copyImagePaths'](null, { id: noImages.item.id });
  assert.equal(fail.ok, false);
});

check('S14 abrir carpeta y eliminar validan el id', async (h) => {
  const bad = await h['bugs:openFolder'](null, { id: '../config' });
  assert.equal(bad.ok, false);
  const created = await h['bugs:create'](null, { title: 'Carpeta' });
  assert.equal((await h['bugs:openFolder'](null, { id: created.item.id })).ok, true);
  assert.equal(fs.existsSync(path.join(stub.__userData, 'bugs', created.item.id)), true);
  await h['bugs:image:add'](null, { id: created.item.id, image: imagePayload('image/png', PNG) });
  assert.equal((await h['bugs:delete'](null, { id: created.item.id })).ok, true);
  assert.equal(fs.existsSync(path.join(stub.__userData, 'bugs', created.item.id)), false);
  assert.equal((await h['bugs:delete'](null, { id: 'no-existe' })).ok, false);
});

check('S4 el borrador se conserva, no guarda vacio y se limpia', async (h) => {
  const empty = await h['bugs:draft:save'](null, { title: '  ', details: '' });
  assert.equal(empty.saved, false);
  assert.equal(fs.existsSync(path.join(stub.__userData, 'bugs', '.draft.json')), false);

  await h['bugs:draft:save'](null, { title: 'A medias', links: [WEB_URL], issueKey: 'CLIN-1' });
  const draft = (await h['bugs:draft:get']()).draft;
  assert.equal(draft.title, 'A medias');
  assert.deepEqual(draft.links.map((link) => link.kind), ['web']);
  assert.equal(draft.issueKey, 'CLIN-1');

  assert.equal((await h['bugs:draft:clear']()).ok, true);
  assert.equal((await h['bugs:draft:get']()).draft, null);
});

check('S5 S15 el contexto y la bandeja no escriben fuera', async (h) => {
  fetched = [];
  stub.clipboard.writeText('');
  assert.equal((await h['bugs:context']()).clipboardUrl, '');

  stub.clipboard.writeText(SLACK_URL);
  assert.equal((await h['bugs:context']()).clipboardUrl, SLACK_URL);
  stub.clipboard.writeText('texto suelto con https://example.com');
  assert.equal((await h['bugs:context']()).clipboardUrl, '', 'una URL incrustada no vale');
  stub.clipboard.writeText('file:///C:/secreto');
  assert.equal((await h['bugs:context']()).clipboardUrl, '', 'solo http y https');

  const created = await h['bugs:create'](null, { title: 'Sin red', links: [WEB_URL] });
  await h['bugs:list']();
  await h['bugs:markdown'](null, { id: created.item.id });
  await h['bugs:update'](null, { id: created.item.id, changes: { state: 'created', jiraKey: 'CLIN-1' } });
  await h['bugs:copyMarkdown'](null, { id: created.item.id });
  await h['bugs:draft:save'](null, { title: 'Borrador' });
  assert.deepEqual(fetched, [], 'la bandeja nunca hace peticiones remotas');
});

check('S5 tras abrir una tarea en la copia, esa es la sugerencia', async (h) => {
  await h['jira:issueCopyData'](null, { config: baseConfig, issueKey: 'CLIN-530' });
  assert.equal((await h['bugs:context']()).issueKey, 'CLIN-530');
  assert.ok(fetched.length > 0, 'la utilidad de copia si consulta Jira');
});

// --------------------------------------------------------------------------
// Ventana principal: contador, filtros y ciclo de vida (S11, S12, S13)
// --------------------------------------------------------------------------

const makeBug = (overrides) =>
  Object.assign(
    {
      id: 'b-20261120100000-aaaa',
      title: 'Boton roto',
      details: 'Al pulsar guardar no pasa nada',
      links: [{ url: SLACK_URL, kind: 'slack' }],
      issueKey: 'CLIN-530',
      images: ['img-1.png'],
      state: 'new',
      jiraKey: '',
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-20T10:00:00.000Z',
      createdJiraAt: null,
    },
    overrides
  );

function bugStore(items) {
  const store = items.map(clone);
  const find = (id) => store.find((item) => item.id === id) || null;
  return {
    store,
    apiResults: {
      listBugs: () => ({ ok: true, items: store.map(clone) }),
      updateBug: (id, changes) => {
        const item = find(id);
        if (!item) return { ok: false, error: 'no existe' };
        if (changes.title !== undefined) {
          const title = String(changes.title || '').trim();
          if (!title) return { ok: false, error: 'El titulo de la incidencia es obligatorio' };
          item.title = title;
        }
        if (changes.details !== undefined) item.details = changes.details;
        if (changes.links !== undefined) item.links = changes.links;
        if (changes.issueKey !== undefined) {
          const match = String(changes.issueKey || '').match(/([A-Za-z][A-Za-z0-9_]*-\d+)/);
          item.issueKey = match ? match[1].toUpperCase() : '';
        }
        if (changes.state !== undefined) {
          if (['new', 'created', 'archived'].indexOf(changes.state) === -1) {
            return { ok: false, error: 'Estado no valido' };
          }
          if (changes.state === 'created') {
            const match = String(changes.jiraKey || '').match(/([A-Za-z][A-Za-z0-9_]*-\d+)/);
            if (!match) return { ok: false, error: 'Escribe la clave de Jira, por ejemplo CLIN-530' };
            item.jiraKey = match[1].toUpperCase();
            item.createdJiraAt = '2026-11-21T09:00:00.000Z';
          }
          if (changes.state === 'new') {
            item.jiraKey = '';
            item.createdJiraAt = null;
          }
          item.state = changes.state;
        }
        return { ok: true, item: clone(item) };
      },
      deleteBug: (id) => {
        const index = store.findIndex((item) => item.id === id);
        if (index === -1) return { ok: false, error: 'no existe' };
        store.splice(index, 1);
        return { ok: true };
      },
      readBugImage: () => ({ ok: true, dataUrl: 'data:image/png;base64,AA==' }),
      deleteBugImage: (id, filename) => {
        const item = find(id);
        if (!item) return { ok: false, error: 'no existe' };
        item.images = item.images.filter((name) => name !== filename);
        return { ok: true, item: clone(item) };
      },
      addBugImage: (id) => {
        const item = find(id);
        if (!item) return { ok: false, error: 'no existe' };
        item.images.push(`img-${item.images.length + 1}.png`);
        return { ok: true, item: clone(item) };
      },
      copyBugMarkdown: () => ({ ok: true, chars: 120 }),
      copyBugImagePaths: () => ({ ok: true, count: 1 }),
      openBugFolder: () => ({ ok: true }),
      openBugCapture: () => ({ ok: true }),
    },
  };
}

async function openBugs(harness) {
  await harness.advance(0);
  harness.el('bugsBtn').dispatch('click');
  await harness.advance(0);
}

check('S11 la modal lista pendientes con contador y pestanas', async () => {
  const fake = bugStore([
    makeBug({}),
    makeBug({ id: 'b-20261120110000-bbbb', title: 'Ya creada', state: 'created', jiraKey: 'CLIN-7' }),
    makeBug({ id: 'b-20261120120000-cccc', title: 'Archivada', state: 'archived' }),
  ]);
  const harness = createHarness({ apiResults: fake.apiResults });
  await openBugs(harness);

  assert.equal(harness.isHidden('bugsModal'), false, 'la modal abierta');
  assert.equal(harness.el('bugList').children.length, 1, 'pendientes solo');
  assert.equal(harness.el('bugsCount').textContent, '1');
  assert.equal(harness.el('bugsCount').classList.contains('hidden'), false);
  assert.equal(harness.el('bugCountCreated').textContent, '1');
  assert.equal(harness.el('bugCountAll').textContent, '3');

  harness.el('bugTabCreated').dispatch('click');
  assert.equal(harness.el('bugList').children.length, 1);
  assert.equal(harness.el('bugList').children[0].children[0].textContent, 'Ya creada');
  assert.equal(harness.el('bugTabCreated').classList.contains('active'), true);
  assert.equal(harness.el('bugTabPending').classList.contains('active'), false);

  harness.el('bugTabAll').dispatch('click');
  assert.equal(harness.el('bugList').children.length, 3);

  harness.el('bugSearch').value = 'archivada';
  harness.el('bugSearch').dispatch('input');
  assert.equal(harness.el('bugList').children.length, 1);
  harness.el('bugSearch').value = 'slack';
  harness.el('bugSearch').dispatch('input');
  assert.equal(harness.el('bugList').children.length, 3, 'tambien busca en enlaces');
  harness.el('bugSearch').value = 'zzzzz';
  harness.el('bugSearch').dispatch('input');
  assert.equal(harness.el('bugList').children[0].className, 'bug-list-empty');
});

check('S12 S13 la vista de detalle edita y marca como creada', async () => {
  const fake = bugStore([makeBug({})]);
  const harness = createHarness({ apiResults: fake.apiResults });
  await openBugs(harness);

  harness.el('bugList').children[0].dispatch('click');
  await harness.advance(0);

  assert.equal(harness.isHidden('bugDetailBody'), false);
  assert.equal(harness.el('bugTitleInput').value, 'Boton roto');
  assert.equal(harness.el('bugDetailsInput').value, 'Al pulsar guardar no pasa nada');
  assert.equal(harness.el('bugIssueInput').value, 'CLIN-530');
  assert.equal(harness.el('bugLinkChips').children.length, 1);
  assert.equal(harness.el('bugLinkChips').children[0].children[0].textContent, 'Slack');
  assert.equal(harness.el('bugImages').children.length, 1);
  assert.equal(harness.el('bugCreatedRow').classList.contains('hidden'), false);
  assert.equal(harness.el('bugArchiveBtn').textContent, 'Archivar');

  harness.el('bugJiraKeyInput').value = 'no-es-clave';
  harness.el('bugMarkCreatedBtn').dispatch('click');
  await harness.advance(0);
  assert.match(harness.el('bugMessage').textContent, /Error/);
  assert.equal(fake.store[0].state, 'new', 'una clave invalida no cambia nada');

  harness.el('bugJiraKeyInput').value = JIRA_URL;
  harness.el('bugMarkCreatedBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(fake.store[0].state, 'created');
  assert.equal(fake.store[0].jiraKey, 'CLIN-530');
  assert.equal(harness.el('bugCreatedRow').classList.contains('hidden'), true);
  assert.equal(harness.el('bugCreatedInfo').classList.contains('hidden'), false);
  assert.equal(harness.el('bugCreatedInfo').children[1].textContent, 'CLIN-530');
  assert.equal(harness.el('bugCountPending').textContent, '0');
  assert.equal(harness.el('bugsCount').classList.contains('hidden'), true, 'sin pendientes no hay contador');

  harness.el('bugTitleInput').value = 'Boton roto v2';
  harness.el('bugSaveBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(fake.store[0].title, 'Boton roto v2');
  assert.match(harness.el('bugMessage').textContent, /guardados/);

  harness.el('bugLinkInput').value = WEB_URL;
  harness.el('bugAddLinkBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(harness.el('bugLinkChips').children.length, 2);
  harness.el('bugLinkChips').children[1].children[2].dispatch('click');
  await harness.advance(0);
  assert.equal(harness.el('bugLinkChips').children.length, 1, 'el boton quitar elimina el chip');
  harness.el('bugSaveBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(fake.store[0].links.length, 1);
});

check('S12 imagenes y archivar desde la vista de detalle', async () => {
  const fake = bugStore([makeBug({ images: [] })]);
  const harness = createHarness({ apiResults: fake.apiResults });
  await openBugs(harness);
  harness.el('bugList').children[0].dispatch('click');
  await harness.advance(0);

  assert.equal(harness.el('bugImagesEmpty').textContent, 'Sin imagenes.');
  harness.el('bugImageInput').files = [
    { name: 'a.png', type: 'image/png', size: 10, arrayBuffer: async () => toArrayBuffer(PNG) },
    { name: 'b.bmp', type: 'image/bmp', size: 10, arrayBuffer: async () => toArrayBuffer(PNG) },
  ];
  harness.el('bugImageInput').dispatch('change');
  await harness.advance(0);
  assert.equal(fake.store[0].images.length, 1, 'solo se acepta el PNG');
  assert.equal(harness.el('bugImages').children.length, 1);
  assert.match(harness.el('bugMessage').textContent, /1 imagen\(es\) anadidas/);
  assert.match(harness.el('bugMessage').textContent, /1 archivo\(s\) descartados/);

  harness.el('bugImages').children[0].children[1].dispatch('click');
  await harness.advance(0);
  assert.deepEqual(fake.store[0].images, []);
  assert.equal(harness.el('bugImagesEmpty').textContent, 'Sin imagenes.');

  harness.el('bugArchiveBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(fake.store[0].state, 'archived');
  assert.equal(harness.el('bugArchiveBtn').textContent, 'Restaurar');
  harness.el('bugArchiveBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(fake.store[0].state, 'new', 'restaurar vuelve a pendientes');
});

check('S12 eliminar pide confirmacion', async () => {
  const fake = bugStore([makeBug({}), makeBug({ id: 'b-20261120110000-bbbb', title: 'Otra' })]);
  const harness = createHarness({ apiResults: fake.apiResults });
  await openBugs(harness);
  harness.el('bugList').children[0].dispatch('click');
  await harness.advance(0);

  harness.el('bugDeleteBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(harness.el('bugDeleteBtn').textContent, 'Confirmar eliminacion');
  assert.equal(fake.store.length, 2, 'el primer clic no borra');

  harness.el('bugDeleteBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(fake.store.length, 1);
  assert.equal(harness.el('bugList').children.length, 1);
  assert.equal(harness.isHidden('bugDetailBody'), true);
});

check('S1 S7 la modal de ajustes refleja y captura el atajo', async () => {
  const harness = createHarness({
    apiResults: {
      getConfig: { baseUrl: 'https://jira.example', apiToken: 'tok', bugHotkey: 'Control+Alt+K' },
      saveConfig: { ok: true },
    },
  });
  await harness.advance(0);
  harness.el('settingsBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(harness.el('bugHotkey').value, 'Ctrl+Alt+K');

  harness.el('bugHotkey').dispatch('focus');
  assert.equal(harness.el('bugHotkey').value, 'Pulsa una combinacion...');
  harness.el('bugHotkey').dispatch('keydown', {
    key: 'b',
    code: 'KeyB',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    preventDefault: () => {},
  });
  assert.equal(harness.el('bugHotkey').value, 'Ctrl+Alt+B');
  harness.el('bugHotkey').dispatch('keydown', {
    key: 'j',
    code: 'KeyJ',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: () => {},
  });
  assert.equal(harness.el('bugHotkey').value, 'Ctrl+Alt+B', 'una tecla suelta no cambia el atajo');
  assert.match(harness.el('formMessage').textContent, /Combina/);

  harness.el('configForm').dispatch('submit', { preventDefault: () => {} });
  await harness.advance(0);
  const saved = harness.calls.filter((call) => call.name === 'saveConfig').pop();
  assert.equal(saved.args[0].bugHotkey, 'Control+Alt+B');
  assert.equal(saved.args[0].bugStartAtLogin, false);
});

check('S7 un atajo rechazado deja el campo con el que sigue activo', async () => {
  const harness = createHarness({
    apiResults: {
      getConfig: {
        baseUrl: 'https://jira.example',
        apiToken: 'tok',
        bugHotkey: 'Control+Alt+J',
        bugShortcutActive: true,
      },
      saveConfig: { ok: true, hotkeyError: 'No se pudo registrar Ctrl+Alt+B.' },
    },
  });
  await openBugs(harness);
  harness.el('settingsBtn').dispatch('click');
  await harness.advance(0);
  harness.el('configForm').dispatch('submit', { preventDefault: () => {} });
  await harness.advance(0);
  assert.equal(harness.el('bugHotkey').value, 'Ctrl+Alt+J');
  assert.equal(harness.isHidden('modal'), false, 'la modal sigue abierta para reintentar');
  assert.match(harness.el('formMessage').textContent, /No se pudo registrar/);
});

check('S11 el contador se refresca al volver a la ventana', async () => {
  const items = [makeBug({})];
  const harness = createHarness({
    apiResults: Object.assign(bugStore(items).apiResults, {
      listBugs: () => ({ ok: true, items: items.map(clone) }),
    }),
  });
  await harness.advance(0);
  assert.equal(harness.el('bugsCount').textContent, '1');
  items.push(makeBug({ id: 'b-20261120130000-dddd', title: 'Nueva captura' }));
  await harness.dispatchWindow('focus');
  assert.equal(harness.el('bugsCount').textContent, '2');
  assert.equal(harness.el('bugCountAll').textContent, '2');
});

// --------------------------------------------------------------------------
// Ventana de captura (S1, S2, S3, S4, S5, S6)
// --------------------------------------------------------------------------

function captureHarness(overrides) {
  const calls = [];
  const apiResults = Object.assign(
    {
      createBug: (payload) => {
        calls.push({ name: 'createBug', payload });
        return { ok: true, item: makeBug({ title: payload.title }), failed: 0 };
      },
      getBugContext: () => {
        calls.push({ name: 'getBugContext' });
        return { ok: true, issueKey: 'CLIN-530', clipboardUrl: SLACK_URL };
      },
      getBugDraft: () => ({ ok: true, draft: null }),
      saveBugDraft: (draft) => {
        calls.push({ name: 'saveBugDraft', draft });
        return { ok: true, saved: true };
      },
      clearBugDraft: () => {
        calls.push({ name: 'clearBugDraft' });
        return { ok: true };
      },
      closeBugCapture: () => {
        calls.push({ name: 'closeBugCapture' });
        return { ok: true };
      },
    },
    overrides || {}
  );
  const harness = createHarness({
    sourceFile: path.join('renderer', 'capture', 'capture.js'),
    apiResults,
  });
  return { harness, calls };
}

const keyEvent = (key, modifiers) =>
  Object.assign({ key, code: 'Key' + key.toUpperCase(), preventDefault: () => {} }, modifiers || {});

const fileEvent = (name, type, size) => ({
  name,
  type,
  size,
  arrayBuffer: async () => toArrayBuffer(PNG),
});

check('S2 S5 S6 la captura prerrellena y guarda con Enter', async () => {
  const { harness, calls } = captureHarness();
  await harness.advance(0);

  assert.equal(harness.el('titleInput').value, '', 'empieza vacio');
  assert.equal(harness.el('issueInput').value, 'CLIN-530', 'sugiere el ultimo issue');
  assert.equal(harness.el('linkChips').children.length, 1, 'ofrece la URL del portapapeles');
  assert.equal(harness.el('linkChips').children[0].children[0].textContent, 'Slack');

  harness.el('titleInput').value = '  Boton roto ';
  harness.el('detailsInput').value = 'no guarda';
  harness.el('titleInput').dispatch('keydown', keyEvent('Enter'));
  await harness.advance(0);

  const saved = calls.filter((call) => call.name === 'createBug').pop();
  assert.equal(saved.payload.title, 'Boton roto');
  assert.equal(saved.payload.details, 'no guarda');
  assert.equal(saved.payload.issueKey, 'CLIN-530');
  assert.deepEqual(saved.payload.links.map((link) => link.kind), ['slack']);
  assert.equal(calls.some((call) => call.name === 'clearBugDraft'), true);
  assert.equal(calls.some((call) => call.name === 'closeBugCapture'), true);
});

check('S2 un titulo vacio no cierra la ventana', async () => {
  const { harness, calls } = captureHarness();
  await harness.advance(0);
  harness.el('titleInput').dispatch('keydown', keyEvent('Enter'));
  await harness.advance(0);
  assert.equal(calls.some((call) => call.name === 'createBug'), false);
  assert.equal(calls.some((call) => call.name === 'closeBugCapture'), false);
  assert.equal(harness.el('titleError').classList.contains('hidden'), false);
});

check('S2 Ctrl+Enter guarda desde detalles y Esc guarda borrador', async () => {
  const { harness, calls } = captureHarness();
  await harness.advance(0);
  harness.el('titleInput').value = 'Por ctrl enter';
  harness.document.dispatch('keydown', keyEvent('Enter', { ctrlKey: true }));
  await harness.advance(0);
  assert.equal(calls.filter((call) => call.name === 'createBug').length, 1);

  harness.el('titleInput').value = 'A medias';
  await harness.document.dispatch('keydown', keyEvent('Escape'));
  await harness.advance(0);
  const draft = calls.filter((call) => call.name === 'saveBugDraft').pop();
  assert.equal(draft.draft.title, 'A medias');
  assert.equal(calls.some((call) => call.name === 'closeBugCapture'), true);
});

check('S4 al reabrir se recupera el borrador', async () => {
  const { harness } = captureHarness({
    getBugDraft: () => ({
      ok: true,
      draft: { title: 'Guardado a medias', details: 'nota', links: [WEB_URL], issueKey: 'CLIN-2' },
    }),
  });
  await harness.advance(0);
  assert.equal(harness.el('titleInput').value, 'Guardado a medias');
  assert.equal(harness.el('issueInput').value, 'CLIN-2');
  assert.equal(harness.el('linkChips').children.length, 1);
  assert.equal(harness.el('linkChips').children[0].children[0].textContent, 'Web');
  assert.equal(harness.el('statusText').textContent, 'Borrador recuperado');
});

check('S3 pegar, arrastrar y elegir archivos anade miniaturas', async () => {
  const { harness, calls } = captureHarness();
  await harness.advance(0);
  const pngFile = fileEvent('pantalla.png', 'image/png', 1024);
  await harness.document.dispatch('paste', { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => pngFile }] } });
  assert.equal(harness.el('imageStrip').children.length, 1);
  assert.equal(harness.el('imageError').classList.contains('hidden'), true);

  const dropped = fileEvent('otra.jpg', 'image/jpeg', 1024);
  await harness.document.dispatch('drop', { dataTransfer: { files: [dropped] } });
  assert.equal(harness.el('imageStrip').children.length, 2);
  assert.match(harness.el('dropHint').textContent, /2\/20/);

  harness.el('imageInput').files = [fileEvent('tercera.gif', 'image/gif', 1024)];
  harness.el('imageInput').dispatch('change');
  await harness.advance(0);
  assert.equal(harness.el('imageStrip').children.length, 3);

  harness.el('imageStrip').children[0].children[1].dispatch('click');
  await harness.advance(0);
  assert.equal(harness.el('imageStrip').children.length, 2, 'la miniatura se puede quitar');

  harness.el('titleInput').value = 'Con imagenes';
  harness.el('saveBtn').dispatch('click');
  await harness.advance(0);
  const saved = calls.filter((call) => call.name === 'createBug').pop();
  assert.equal(saved.payload.images.length, 2);
});

check('S3 un archivo demasiado grande se rechaza y la ventana sigue util', async () => {
  const { harness, calls } = captureHarness();
  await harness.advance(0);
  await harness.document.dispatch('paste', {
    clipboardData: {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => fileEvent('enorme.png', 'image/png', 11 * 1024 * 1024),
        },
        { kind: 'file', type: 'application/pdf', getAsFile: () => fileEvent('doc.pdf', 'application/pdf', 10) },
      ],
    },
  });
  assert.equal(harness.el('imageStrip').children.length, 0);
  assert.match(harness.el('imageError').textContent, /10 MB/);
  assert.match(harness.el('imageError').textContent, /descartaron 2/);
  assert.equal(calls.some((call) => call.name === 'closeBugCapture'), false);

  for (let index = 0; index < 21; index++) {
    await harness.document.dispatch('paste', {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => fileEvent(`i${index}.png`, 'image/png', 10) }],
      },
    });
  }
  assert.equal(harness.el('imageStrip').children.length, 20, 'maximo 20 miniaturas');
  assert.match(harness.el('imageError').textContent, /maximo 20 imagenes/);
});

check('S6 anadir enlaces con Enter y quitarlos', async () => {
  const { harness, calls } = captureHarness({
    getBugContext: () => ({ ok: true, issueKey: '', clipboardUrl: '' }),
  });
  await harness.advance(0);
  assert.equal(harness.el('linkChips').children.length, 0);
  assert.equal(harness.el('issueInput').value, '');

  harness.el('linkInput').value = JIRA_URL;
  await harness.el('linkInput').dispatch('keydown', keyEvent('Enter'));
  assert.equal(harness.el('linkChips').children.length, 1);
  assert.equal(harness.el('linkChips').children[0].children[0].textContent, 'Jira');
  assert.equal(harness.el('issueInput').value, 'CLIN-530', 'un enlace de Jira rellena el issue');
  assert.equal(harness.el('linkInput').value, '', 'el campo se limpia');

  harness.el('linkInput').value = 'texto suelto';
  harness.el('addLinkBtn').dispatch('click');
  await harness.advance(0);
  assert.equal(harness.el('linkChips').children[1].children[0].textContent, 'Enlace');

  harness.el('linkChips').children[0].children[2].dispatch('click');
  await harness.advance(0);
  assert.equal(harness.el('linkChips').children.length, 1);

  for (let index = 0; index < 12; index++) {
    harness.el('linkInput').value = `${WEB_URL}?i=${index}`;
    harness.el('addLinkBtn').dispatch('click');
  }
  await harness.advance(0);
  assert.equal(harness.el('linkChips').children.length, 10);
  assert.match(harness.el('linkError').textContent, /Maximo 10/);

  harness.el('titleInput').value = 'Enlaces';
  harness.el('saveBtn').dispatch('click');
  await harness.advance(0);
  const saved = calls.filter((call) => call.name === 'createBug').pop();
  assert.equal(saved.payload.links.length, 10);
});

check('S1 reabrir con capture:shown vuelve a leer el contexto', async () => {
  const { harness } = captureHarness();
  await harness.advance(0);
  harness.el('titleInput').value = 'Texto en curso';
  await harness.fireCaptureShown();
  assert.equal(harness.el('titleInput').value, '', 'se vuelve al estado guardado');
  assert.equal(harness.el('issueInput').value, 'CLIN-530');
});

(async () => {
  let failed = 0;
  try {
    require(path.join(REPO, 'main.js'));
    const h = stub.__handlers;
    for (const item of checks) {
      stub.__reset();
      stub.__shortcuts.unregisterAll();
      fetched = [];
      try {
        await item.fn(h);
        console.log('  ok  - ' + item.name);
      } catch (err) {
        failed += 1;
        console.log('  FAIL- ' + item.name + ' :: ' + (err && err.message));
      }
    }
  } catch (err) {
    failed = checks.length;
    console.error('CHECK FALLA:', err && err.stack);
  } finally {
    stub.__reset();
    console.log(`BUG INBOX CHECKS: ${checks.length - failed}/${checks.length} passed`);
    process.exitCode = failed ? 1 : 0;
  }
})();
