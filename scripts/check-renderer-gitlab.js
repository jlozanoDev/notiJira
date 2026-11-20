'use strict';
// Headless regression checks for the GitLab part of the copy modal.
// Runs the real renderer/renderer.js against a minimal DOM harness.
// Run with: npm run check:renderer   (node + assert, no test framework).
const assert = require('assert');
const { createHarness } = require('./test-support/renderer-stub');

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

const CONFIG_WITHOUT_GITLAB = { baseUrl: 'https://jira.example', apiToken: 'jira-token' };
const CONFIG_WITH_GITLAB = {
  baseUrl: 'https://jira.example',
  apiToken: 'jira-token',
  gitlabUrl: 'https://gitlab.example',
  gitlabToken: 'gitlab-token',
};

const PROJECTS = [
  { id: 41, pathWithNamespace: 'equipo/notijira' },
  { id: 42, pathWithNamespace: 'equipo/chaty' },
  { id: 43, pathWithNamespace: 'otro/grupo-passbox' },
];
const BRANCHES = [
  { name: 'main' },
  { name: 'feature/mr-copy' },
  { name: 'Feature/GITLAB-DIFF' },
  { name: 'release/1.1.1' },
];

const callNames = (harness, name) => harness.calls.filter((call) => call.name === name);
const lastCall = (harness, name) => callNames(harness, name).slice(-1)[0];

// The combobox markup pairs "<field>Input" with "<field>List".
const listFor = (inputId) => inputId.replace('Input', 'List');

// Opens the copy modal through the public path: search -> click the result.
async function openCopyModalFlow(harness) {
  await settle(); // Deja terminar init(): state.config se relee de forma asincrona.
  harness.el('searchInput').value = 'AAA-1';
  harness.el('searchForm').dispatch('submit');
  await settle();
  const rows = harness.el('searchResults').children;
  assert.ok(rows.length > 0, 'el buscador debe listar un resultado');
  rows[0].dispatch('click');
  await settle();
}

async function toggleMr(harness, checked) {
  harness.el('includeMrCheckbox').checked = checked;
  harness.el('includeMrCheckbox').dispatch('change');
  await settle();
}

async function startCopyWithMr(harness) {
  await openCopyModalFlow(harness);
  await toggleMr(harness, true);
}

async function type(harness, inputId, text) {
  const input = harness.el(inputId);
  input.value = text;
  input.dispatch('input');
  await settle();
  const list = harness.el(listFor(inputId));
  return { input, list, labels: list.optionTexts(), open: !list.classList.contains('hidden') };
}

async function pick(harness, inputId, index) {
  const list = harness.el(listFor(inputId));
  assert.ok(list.children.length > index, `sugerencia ${index} inexistente en ${listFor(inputId)}`);
  list.children[index].dispatch('mousedown');
  await settle();
}

async function key(harness, inputId, name) {
  harness.el(inputId).dispatch('keydown', { key: name, preventDefault: () => {} });
  await settle();
}

function withProjects(apiResults) {
  return Object.assign(
    {
      getGitlabProjects: { ok: true, projects: PROJECTS },
      getGitlabBranches: { ok: true, branches: BRANCHES },
    },
    apiResults
  );
}

check('S2 activar Obtener MR sin credenciales abre la configuracion y no consulta GitLab', async () => {
  const h = createHarness({ apiResults: { getConfig: CONFIG_WITHOUT_GITLAB } });
  await startCopyWithMr(h);

  assert.strictEqual(h.isHidden('copyModal'), true, 'la modal de copia debe quedar oculta');
  assert.strictEqual(h.isHidden('modal'), false, 'debe abrirse la pantalla de credenciales');
  assert.strictEqual(h.isHidden('gitlabSelection'), true);
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 0, 'sin credenciales no se consulta GitLab');
  assert.strictEqual(callNames(h, 'saveConfig').length, 0, 'abrir la configuracion no guarda nada');
});

check('S2 cancelar la configuracion vuelve a la copia sin el check marcado', async () => {
  const h = createHarness({ apiResults: { getConfig: CONFIG_WITHOUT_GITLAB } });
  await startCopyWithMr(h);

  h.el('cancelBtn').dispatch('click');
  await settle();

  assert.strictEqual(h.isHidden('copyModal'), false, 'la copia debe volver a estar visible');
  assert.strictEqual(h.el('includeMrCheckbox').checked, false);
  assert.strictEqual(h.isHidden('gitlabSelection'), true);
  assert.strictEqual(callNames(h, 'saveConfig').length, 0, 'cancelar no guarda credenciales');
});

check('S2 guardar credenciales desde la copia deja los buscadores disponibles', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITHOUT_GITLAB }) });
  await startCopyWithMr(h);
  h.el('baseUrl').value = CONFIG_WITHOUT_GITLAB.baseUrl;
  h.el('apiToken').value = CONFIG_WITHOUT_GITLAB.apiToken;
  h.el('gitlabUrl').value = 'gitlab.example';
  h.el('gitlabToken').value = 'gitlab-token';

  h.el('saveGitlabCredentialsBtn').dispatch('click');
  await settle();

  assert.strictEqual(callNames(h, 'saveConfig').length, 1);
  assert.strictEqual(h.isHidden('modal'), true, 'la configuracion debe cerrarse al guardar');
  assert.strictEqual(h.isHidden('copyModal'), false, 'se vuelve a la modal de copia');
  assert.strictEqual(
    h.isHidden('gitlabSelection'),
    false,
    'el panel de GitLab debe quedar visible tras guardar credenciales'
  );
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 1, 'deben consultarse los proyectos');
  assert.strictEqual(h.el('gitlabProjectInput').disabled, false, 'el buscador queda habilitado');
  assert.strictEqual(h.el('gitlabProjectInput').getAttribute('aria-expanded'), 'false');

  const typed = await type(h, 'gitlabProjectInput', 'noti');
  assert.deepStrictEqual(typed.labels, ['equipo/notijira']);
  assert.strictEqual(typed.open, true, 'la lista debe abrirse al escribir');
});

check('S2 guardar la configuracion completa restablece los buscadores', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITHOUT_GITLAB }) });
  await startCopyWithMr(h);
  h.el('baseUrl').value = CONFIG_WITHOUT_GITLAB.baseUrl;
  h.el('apiToken').value = CONFIG_WITHOUT_GITLAB.apiToken;
  h.el('gitlabUrl').value = 'https://gitlab.example';
  h.el('gitlabToken').value = 'gitlab-token';

  h.el('configForm').dispatch('submit');
  await settle();

  assert.strictEqual(h.isHidden('gitlabSelection'), false, 'el panel debe verse tras guardar');
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 1);
  assert.strictEqual(lastCall(h, 'saveConfig').args[0].gitlabUrl, 'https://gitlab.example');
});

check('S2 un rechazo al guardar deja la configuracion abierta y sin buscadores activos', async () => {
  const h = createHarness({
    apiResults: {
      getConfig: CONFIG_WITHOUT_GITLAB,
      saveConfig: { ok: false, error: 'La URL de GitLab debe usar HTTPS y no incluir credenciales' },
    },
  });
  await startCopyWithMr(h);
  h.el('gitlabUrl').value = 'http://gitlab.example';
  h.el('gitlabToken').value = 'gitlab-token';

  h.el('saveGitlabCredentialsBtn').dispatch('click');
  await settle();

  assert.match(h.el('formMessage').textContent, /HTTPS/);
  assert.strictEqual(h.isHidden('modal'), false, 'la configuracion sigue abierta para corregirla');
  assert.strictEqual(h.isHidden('gitlabSelection'), true);
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 0);
});

check('S2 los buscadores usan la configuracion devuelta por el proceso principal', async () => {
  let stored = { ...CONFIG_WITHOUT_GITLAB };
  const h = createHarness({
    apiResults: withProjects({
      getConfig: () => ({ ...stored }),
      saveConfig: (config) => {
        stored = {
          ...config,
          gitlabUrl: config.gitlabUrl.startsWith('http')
            ? config.gitlabUrl
            : `https://${config.gitlabUrl}`,
        };
        return { ok: true };
      },
    }),
  });
  await startCopyWithMr(h);
  h.el('gitlabUrl').value = 'gitlab.example';
  h.el('gitlabToken').value = 'gitlab-token';

  h.el('saveGitlabCredentialsBtn').dispatch('click');
  await settle();

  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 1);
  assert.strictEqual(
    lastCall(h, 'getGitlabProjects').args[0].gitlabUrl,
    'https://gitlab.example',
    'el renderer debe consultar con la URL normalizada por el proceso principal'
  );
});

check('S2 borrar credenciales limpia GitLab del estado del renderer', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);
  assert.strictEqual(h.isHidden('gitlabSelection'), false, 'con credenciales el panel se abre');
  h.el('gitlabUrl').value = 'https://gitlab.example';
  h.el('gitlabToken').value = 'otro-token';

  h.el('removeGitlabCredentialsBtn').dispatch('click');
  await settle();

  const saved = lastCall(h, 'saveConfig').args[0];
  assert.strictEqual(saved.gitlabUrl, '');
  assert.strictEqual(saved.gitlabToken, '');
  assert.strictEqual(h.el('gitlabUrl').value, '');
  assert.strictEqual(h.el('gitlabToken').value, '');
  assert.match(h.el('formMessage').textContent, /eliminadas/);
});

check('S2 una respuesta atrasada no sustituye los proyectos de la seleccion mas reciente', async () => {
  let releaseStale;
  let calls = 0;
  const h = createHarness({
    apiResults: {
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabBranches: { ok: true, branches: BRANCHES },
      getGitlabProjects: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise((resolve) => {
            releaseStale = () =>
              resolve({ ok: true, projects: [{ id: 1, pathWithNamespace: 'viejo/proyecto' }] });
          });
        }
        return Promise.resolve({ ok: true, projects: PROJECTS });
      },
    },
  });
  await startCopyWithMr(h);

  await toggleMr(h, false);
  await toggleMr(h, true);

  const fresh = await type(h, 'gitlabProjectInput', 'equipo');
  assert.deepStrictEqual(fresh.labels, ['equipo/notijira', 'equipo/chaty']);

  releaseStale();
  await settle();

  const afterStale = await type(h, 'gitlabProjectInput', 'viejo');
  assert.deepStrictEqual(
    afterStale.labels,
    ['Sin coincidencias'],
    'la respuesta atrasada no debe reemplazar los proyectos actuales'
  );
});

check('S6 filtrar proyecto coincide por subcadena sin distinguir mayusculas', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 1, 'el panel carga los proyectos');

  const upper = await type(h, 'gitlabProjectInput', 'NOTI');
  assert.deepStrictEqual(upper.labels, ['equipo/notijira'], 'mayusculas indiferentes');

  const partial = await type(h, 'gitlabProjectInput', 'grupo-pass');
  assert.deepStrictEqual(partial.labels, ['otro/grupo-passbox'], 'subcadena interna del nombre');

  const none = await type(h, 'gitlabProjectInput', 'inexistente');
  assert.deepStrictEqual(none.labels, ['Sin coincidencias'], 'aviso explicito de cero coincidencias');
  assert.strictEqual(none.open, true);

  assert.strictEqual(
    callNames(h, 'getGitlabProjects').length,
    1,
    'escribir no vuelve a consultar GitLab: se filtra la lista ya traida'
  );

  const cleared = await type(h, 'gitlabProjectInput', '');
  assert.deepStrictEqual(
    cleared.labels,
    ['equipo/notijira', 'equipo/chaty', 'otro/grupo-passbox'],
    'sin texto se ofrecen todos los proyectos'
  );
});

check('S6 elegir una sugerencia fija el proyecto y carga sus ramas', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  await type(h, 'gitlabProjectInput', 'chaty');
  await pick(h, 'gitlabProjectInput', 0);

  assert.strictEqual(h.el('gitlabProjectInput').value, 'equipo/chaty');
  assert.strictEqual(h.el('gitlabProjectList').classList.contains('hidden'), true);
  assert.strictEqual(h.el('gitlabProjectInput').getAttribute('aria-expanded'), 'false');
  assert.strictEqual(callNames(h, 'getGitlabBranches').length, 1);
  assert.strictEqual(lastCall(h, 'getGitlabBranches').args[1], '42');
  assert.strictEqual(h.el('gitlabSourceBranchInput').disabled, false);

  const src = await type(h, 'gitlabSourceBranchInput', 'feature');
  assert.deepStrictEqual(src.labels, ['feature/mr-copy', 'Feature/GITLAB-DIFF']);

  await pick(h, 'gitlabSourceBranchInput', 0);
  const dst = await type(h, 'gitlabTargetBranchInput', 'main');
  assert.deepStrictEqual(dst.labels, ['main']);

  assert.strictEqual(
    callNames(h, 'getGitlabBranches').length,
    1,
    'las ramas se filtran de la lista ya cargada'
  );
});

check('S6 el teclado baja por las sugerencias y confirma con Enter', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  const typed = await type(h, 'gitlabProjectInput', 'equipo');
  assert.deepStrictEqual(typed.labels, ['equipo/notijira', 'equipo/chaty']);

  await key(h, 'gitlabProjectInput', 'ArrowDown');
  await key(h, 'gitlabProjectInput', 'ArrowDown');
  assert.strictEqual(
    h.el('gitlabProjectList').children[1].classList.contains('active'),
    true,
    'la segunda sugerencia debe quedar activa'
  );

  await key(h, 'gitlabProjectInput', 'Enter');
  assert.strictEqual(h.el('gitlabProjectInput').value, 'equipo/chaty', 'Enter confirma la sugerencia activa');
  assert.strictEqual(callNames(h, 'getGitlabBranches').length, 1, 'y carga sus ramas');

  await key(h, 'gitlabProjectInput', 'ArrowDown');
  await key(h, 'gitlabProjectInput', 'Escape');
  assert.strictEqual(h.el('gitlabProjectList').classList.contains('hidden'), true, 'Escape cierra');
  assert.strictEqual(h.el('gitlabProjectInput').value, 'equipo/chaty', 'Escape conserva la eleccion');
});

check('S6 un texto de proyecto sin coincidencia bloquea la copia y lo avisa', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  await type(h, 'gitlabProjectInput', 'no-existe');
  h.el('copyDoBtn').dispatch('click');
  await settle();

  assert.strictEqual(callNames(h, 'copyIssue').length, 0, 'no se copia sin proyecto valido');
  const message = h.el('gitlabMessage').textContent + ' ' + h.el('copyMessage').textContent;
  assert.match(message, /proyecto/, `debe avisar del proyecto: ${message}`);
});

check('S6 copiar envia el proyecto elegido y la rama escrita exacta', async () => {
  const h = createHarness({
    apiResults: withProjects({
      getConfig: CONFIG_WITH_GITLAB,
      copyIssue: {
        ok: true,
        sections: 1,
        comments: 0,
        attachments: 0,
        downloaded: 0,
        failed: 0,
        folder: '',
      },
    }),
  });
  await startCopyWithMr(h);

  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);
  await type(h, 'gitlabSourceBranchInput', 'feature/mr-copy');
  await pick(h, 'gitlabSourceBranchInput', 0);
  await type(h, 'gitlabTargetBranchInput', 'main');
  h.el('gitlabTargetBranchInput').dispatch('blur');
  await settle();

  h.el('copyDoBtn').dispatch('click');
  await settle();

  const payload = lastCall(h, 'copyIssue').args[1];
  assert.strictEqual(payload.includeMr, true);
  assert.strictEqual(payload.gitlab.projectId, '41');
  assert.strictEqual(payload.gitlab.projectName, 'equipo/notijira');
  assert.strictEqual(payload.gitlab.sourceBranch, 'feature/mr-copy');
  assert.strictEqual(payload.gitlab.targetBranch, 'main', 'un nombre exacto escrito vale como seleccion');
  assert.match(h.el('statusBar').textContent, /diff de MR/);
});

check('S6 un nombre de ramo incompleto no vale: hay que elegir una sugerencia', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);
  await type(h, 'gitlabSourceBranchInput', 'feature');
  h.el('gitlabSourceBranchInput').dispatch('blur');
  await type(h, 'gitlabTargetBranchInput', 'main');
  h.el('gitlabTargetBranchInput').dispatch('blur');
  await settle();

  h.el('copyDoBtn').dispatch('click');
  await settle();

  assert.strictEqual(callNames(h, 'copyIssue').length, 0, 'no se copia con una rama ambigua');
  const message = h.el('gitlabMessage').textContent + ' ' + h.el('copyMessage').textContent;
  assert.match(message, /rama/, `debe avisar de la rama: ${message}`);
});

check('S6 desmarcar Obtener MR limpia los buscadores y sus valores', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);
  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);
  await type(h, 'gitlabSourceBranchInput', 'main');
  await pick(h, 'gitlabSourceBranchInput', 0);

  await toggleMr(h, false);

  assert.strictEqual(h.isHidden('gitlabSelection'), true);
  for (const id of ['gitlabProjectInput', 'gitlabSourceBranchInput', 'gitlabTargetBranchInput']) {
    assert.strictEqual(h.el(id).value, '', `${id} queda vacio`);
    assert.strictEqual(h.el(id).disabled, true, `${id} queda deshabilitado`);
  }
  assert.strictEqual(h.el('gitlabProjectList').optionTexts().length, 0);
});

check('S6 cambiar de proyecto descarta las ramas elegidas', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);
  await type(h, 'gitlabSourceBranchInput', 'main');
  await pick(h, 'gitlabSourceBranchInput', 0);
  assert.strictEqual(h.el('gitlabSourceBranchInput').value, 'main');

  await type(h, 'gitlabProjectInput', 'chaty');
  await pick(h, 'gitlabProjectInput', 0);

  assert.strictEqual(callNames(h, 'getGitlabBranches').length, 2);
  assert.strictEqual(lastCall(h, 'getGitlabBranches').args[1], '42');
  assert.strictEqual(h.el('gitlabSourceBranchInput').value, '', 'la rama del proyecto anterior se descarta');
  assert.strictEqual(h.el('gitlabTargetBranchInput').value, '');
});

(async () => {
  let failed = 0;
  for (const c of checks) {
    try {
      await c.fn();
      console.log('  ok  - ' + c.name);
    } catch (err) {
      failed += 1;
      console.log('  FAIL- ' + c.name + ' :: ' + (err && err.message));
    }
  }
  console.log(`RENDERER GITLAB CHECKS: ${checks.length - failed}/${checks.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error('CHECK FALLA:', err && err.stack);
  process.exitCode = 1;
});
