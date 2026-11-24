'use strict';
// Headless regression checks for the GitLab part of the copy modal.
// Runs the real renderer/renderer.js against a minimal DOM harness with a fake
// clock, so debounced server-side searches are asserted deterministically.
// Run with: npm run check:renderer   (node + assert, no test framework).
const assert = require('assert');
const { createHarness } = require('./test-support/renderer-stub');

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// The renderer debounces searches at 250 ms; tests advance a fake clock.
const DEBOUNCE = 250;
const settle = async (harness, ms = DEBOUNCE + 70) => {
  for (let i = 0; i < 3; i++) await tick();
  if (harness && ms) await harness.advance(ms);
  for (let i = 0; i < 6; i++) await tick();
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
  { name: 'develop' },
  { name: 'feature/AAA-1-fix' },
  { name: 'feature/mr-copy' },
  { name: 'Feature/GITLAB-DIFF' },
  { name: 'release/1.1.1' },
];

// Emulates GitLab's `search` parameter: substring, case-insensitive.
const matchesTerm = (label, term) =>
  !term || String(label).toLowerCase().includes(String(term).toLowerCase());
const filterProjects = (term) => PROJECTS.filter((project) => matchesTerm(project.pathWithNamespace, term));
const filterBranches = (term) => BRANCHES.filter((branch) => matchesTerm(branch.name, term));

const callNames = (harness, name) => harness.calls.filter((call) => call.name === name);
const lastCall = (harness, name) => callNames(harness, name).slice(-1)[0];

// Defaults: a server that answers `search` like GitLab does.
function withProjects(...overrides) {
  return Object.assign(
    {
      getGitlabProjects: (config, term) =>
        Promise.resolve({ ok: true, projects: filterProjects(term), truncated: false }),
      getGitlabBranches: (config, projectId, term) =>
        Promise.resolve({ ok: true, branches: filterBranches(term), truncated: false }),
    },
    ...overrides
  );
}

// The combobox markup pairs "<field>Input" with "<field>List".
const listFor = (inputId) => inputId.replace('Input', 'List');

// Opens the copy modal through the public path: type in the Jira combobox and
// choose the first suggestion with the keyboard, exactly like a user would.
async function openCopyModalFlow(harness) {
  await settle(harness);
  const input = harness.el('searchInput');
  input.value = 'AAA-1';
  input.dispatch('input');
  await settle(harness);
  const rows = harness.el('searchList').children;
  assert.ok(rows.length > 0, 'el buscador de Jira debe listar un resultado');
  rows[0].dispatch('mousedown', { preventDefault: () => {} });
  await settle(harness);
}

async function toggleMr(harness, checked) {
  harness.el('includeMrCheckbox').checked = checked;
  harness.el('includeMrCheckbox').dispatch('change');
  await settle(harness);
}

async function startCopyWithMr(harness) {
  await openCopyModalFlow(harness);
  await toggleMr(harness, true);
}

// Types into a combobox, lets the debounce fire, returns what GitLab suggested.
async function type(harness, inputId, text) {
  const input = harness.el(inputId);
  input.value = text;
  input.dispatch('input');
  await settle(harness);
  const list = harness.el(listFor(inputId));
  return { input, list, labels: list.optionTexts(), open: !list.classList.contains('hidden') };
}

async function pick(harness, inputId, index) {
  const list = harness.el(listFor(inputId));
  assert.ok(list.children.length > index, `sugerencia ${index} inexistente en ${listFor(inputId)}`);
  list.children[index].dispatch('mousedown');
  await settle(harness);
}

async function key(harness, inputId, name) {
  harness.el(inputId).dispatch('keydown', { key: name, preventDefault: () => {} });
  await settle(harness);
}

function fillJiraAndGitLab(harness, url, token) {
  harness.el('baseUrl').value = CONFIG_WITHOUT_GITLAB.baseUrl;
  harness.el('email').value = '';
  harness.el('apiToken').value = CONFIG_WITHOUT_GITLAB.apiToken;
  harness.el('updateUrl').value = '';
  harness.el('gitlabUrl').value = url;
  harness.el('gitlabToken').value = token;
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
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITHOUT_GITLAB }) });
  await startCopyWithMr(h);

  h.el('cancelBtn').dispatch('click');
  await settle(h);

  assert.strictEqual(h.isHidden('copyModal'), false, 'la copia debe volver a estar visible');
  assert.strictEqual(h.el('includeMrCheckbox').checked, false);
  assert.strictEqual(h.isHidden('gitlabSelection'), true);
  assert.strictEqual(callNames(h, 'saveConfig').length, 0, 'cancelar no guarda credenciales');
});

check('S2 guardar credenciales desde la copia deja los buscadores con sugerencias', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITHOUT_GITLAB }) });
  await startCopyWithMr(h);
  fillJiraAndGitLab(h, 'gitlab.example', 'gitlab-token');

  h.el('saveGitlabCredentialsBtn').dispatch('click');
  await settle(h);

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
  fillJiraAndGitLab(h, 'https://gitlab.example', 'gitlab-token');

  h.el('configForm').dispatch('submit');
  await settle(h);

  assert.strictEqual(h.isHidden('gitlabSelection'), false, 'el panel debe verse tras guardar');
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 1);
  assert.strictEqual(lastCall(h, 'saveConfig').args[0].gitlabUrl, 'https://gitlab.example');
});

check('S2 un rechazo al guardar deja la configuracion abierta y sin buscadores activos', async () => {
  const h = createHarness({
    apiResults: withProjects(
      { getConfig: CONFIG_WITHOUT_GITLAB },
      { saveConfig: { ok: false, error: 'La URL de GitLab debe usar HTTPS y no incluir credenciales' } }
    ),
  });
  await startCopyWithMr(h);
  fillJiraAndGitLab(h, 'http://gitlab.example', 'gitlab-token');

  h.el('saveGitlabCredentialsBtn').dispatch('click');
  await settle(h);

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
  fillJiraAndGitLab(h, 'gitlab.example', 'gitlab-token');

  h.el('saveGitlabCredentialsBtn').dispatch('click');
  await settle(h);

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
  fillJiraAndGitLab(h, 'https://gitlab.example', 'otro-token');

  h.el('removeGitlabCredentialsBtn').dispatch('click');
  await settle(h);

  const saved = lastCall(h, 'saveConfig').args[0];
  assert.strictEqual(saved.gitlabUrl, '');
  assert.strictEqual(saved.gitlabToken, '');
  assert.strictEqual(h.el('gitlabUrl').value, '');
  assert.strictEqual(h.el('gitlabToken').value, '');
  assert.match(h.el('formMessage').textContent, /eliminadas/);
});

check('S2 una respuesta atrasada de proyectos no sustituye la seleccion mas reciente', async () => {
  let releaseStale;
  let calls = 0;
  const h = createHarness({
    apiResults: withProjects({
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabProjects: (config, term) => {
        calls += 1;
        if (calls === 1) {
          return new Promise((resolve) => {
            releaseStale = () =>
              resolve({ ok: true, projects: [{ id: 1, pathWithNamespace: 'viejo/proyecto' }] });
          });
        }
        return Promise.resolve({ ok: true, projects: filterProjects(term) });
      },
    }),
  });
  await startCopyWithMr(h);
  await toggleMr(h, false);
  await toggleMr(h, true);

  const fresh = await type(h, 'gitlabProjectInput', 'equipo');
  assert.deepStrictEqual(fresh.labels, ['equipo/notijira', 'equipo/chaty']);

  releaseStale();
  await settle(h);
  const afterStale = await type(h, 'gitlabProjectInput', 'viejo');
  assert.deepStrictEqual(
    afterStale.labels,
    ['Sin coincidencias'],
    'la respuesta atrasada no debe reemplazar los proyectos actuales'
  );
});

check('S7 al abrir el panel se carga la primera pagina sin texto', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  const calls = callNames(h, 'getGitlabProjects');
  assert.strictEqual(calls.length, 1);
  assert.ok(!calls[0].args[1], 'la carga inicial no envia search');
  assert.deepStrictEqual(h.el('gitlabProjectList').optionTexts(), []);

  const focused = await type(h, 'gitlabProjectInput', '');
  assert.deepStrictEqual(focused.labels, [
    'equipo/notijira',
    'equipo/chaty',
    'otro/grupo-passbox',
  ]);
});

check('S7 escribir consulta a GitLab con debounce, no por cada tecla', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 1);

  // Cuatro teclas seguidas: solo debe salir una peticion.
  for (const text of ['n', 'no', 'not', 'noti']) {
    h.el('gitlabProjectInput').value = text;
    h.el('gitlabProjectInput').dispatch('input');
    await settle(h, 120); // dentro de la ventana del retardo: no debe salir nada
  }
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 1, 'nada sale a la red antes del retardo');

  await settle(h, DEBOUNCE);
  const calls = callNames(h, 'getGitlabProjects');
  assert.strictEqual(calls.length, 2, 'una sola peticion tras el retardo');
  assert.strictEqual(calls[1].args[1], 'noti', 'se envia el ultimo texto escrito');
  assert.deepStrictEqual(h.el('gitlabProjectList').optionTexts(), ['equipo/notijira']);
});

check('S7 origen y destino consultan de forma independiente', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);
  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);

  const before = callNames(h, 'getGitlabBranches').length;
  await type(h, 'gitlabSourceBranchInput', 'feature');
  await type(h, 'gitlabTargetBranchInput', 'release');

  const calls = callNames(h, 'getGitlabBranches').slice(before);
  assert.deepStrictEqual(calls.map((call) => call.args[2]), ['feature', 'release']);
  assert.deepStrictEqual(h.el('gitlabSourceBranchList').optionTexts(), [
    'feature/AAA-1-fix',
    'feature/mr-copy',
    'Feature/GITLAB-DIFF',
  ]);
  assert.deepStrictEqual(h.el('gitlabTargetBranchList').optionTexts(), ['release/1.1.1']);
});

check('S7 una respuesta atrasada no pisa la lista mas reciente del mismo campo', async () => {
  let releaseStale;
  const h = createHarness({
    apiResults: withProjects({
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabBranches: (config, projectId, term) => {
        if (term === 'vieja') {
          return new Promise((resolve) => {
            releaseStale = () => resolve({ ok: true, branches: [{ name: 'vieja/rama' }] });
          });
        }
        if (term === 'nueva') {
          return Promise.resolve({ ok: true, branches: [{ name: 'nueva/rama' }] });
        }
        return Promise.resolve({ ok: true, branches: filterBranches(term) });
      },
    }),
  });
  await startCopyWithMr(h);
  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);

  h.el('gitlabSourceBranchInput').value = 'vieja';
  h.el('gitlabSourceBranchInput').dispatch('input');
  await settle(h); // sale la peticion y se queda colgada
  h.el('gitlabSourceBranchInput').value = 'nueva';
  h.el('gitlabSourceBranchInput').dispatch('input');
  await settle(h);
  assert.deepStrictEqual(h.el('gitlabSourceBranchList').optionTexts(), ['nueva/rama']);

  releaseStale();
  await settle(h);
  assert.deepStrictEqual(
    h.el('gitlabSourceBranchList').optionTexts(),
    ['nueva/rama'],
    'la respuesta lenta no debe reemplazar la lista actual'
  );
});

check('S7 desmarcar el check descarta las busquedas que estan en vuelo', async () => {
  let releasePending;
  const h = createHarness({
    apiResults: withProjects({
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabProjects: (config, term) =>
        term === 'lento'
          ? new Promise((resolve) => {
              releasePending = () => resolve({ ok: true, projects: filterProjects('') });
            })
          : Promise.resolve({ ok: true, projects: filterProjects(term) }),
    }),
  });
  await startCopyWithMr(h);

  h.el('gitlabProjectInput').value = 'lento';
  h.el('gitlabProjectInput').dispatch('input');
  await settle(h);
  await toggleMr(h, false);

  releasePending();
  await settle(h);
  assert.strictEqual(h.el('gitlabProjectList').optionTexts().length, 0, 'la respuesta tardia se ignora');
});

check('S7 avisa cuando GitLab devuelve la pagina completa', async () => {
  const many = [];
  for (let i = 0; i < 100; i++) many.push({ id: 500 + i, pathWithNamespace: `grupo/proyecto-${i}` });
  const h = createHarness({
    apiResults: withProjects({
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabProjects: (config, term) =>
        Promise.resolve(
          term === 'muchos'
            ? { ok: true, projects: many, truncated: true }
            : { ok: true, projects: [], truncated: false }
        ),
    }),
  });
  await startCopyWithMr(h);
  await type(h, 'gitlabProjectInput', 'muchos');

  assert.match(h.el('gitlabMessage').textContent, /100/);
  assert.match(h.el('gitlabMessage').textContent, /concreto/);
});

check('S7 un error de GitLab se muestra con el texto de siempre y deja reintentar', async () => {
  let failing = true;
  const h = createHarness({
    apiResults: withProjects({
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabProjects: (config, term) => {
        if (failing) return Promise.resolve({ ok: false, error: 'GitLab respondio 401' });
        return Promise.resolve({ ok: true, projects: filterProjects(term) });
      },
    }),
  });
  await startCopyWithMr(h);

  assert.strictEqual(
    h.el('gitlabMessage').textContent,
    'Error al consultar GitLab: GitLab respondio 401',
    'el texto del error de proyectos no cambia respecto a la version anterior'
  );
  assert.strictEqual(h.el('gitlabProjectInput').disabled, false, 'el buscador sigue usable tras el fallo');

  failing = false;
  const typed = await type(h, 'gitlabProjectInput', 'notijira');
  assert.deepStrictEqual(typed.labels, ['equipo/notijira'], 'se puede reintentar sin remarcar el check');
});

check('S7 las ramas se pueden editar en cuanto hay proyecto elegido', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  assert.strictEqual(h.el('gitlabSourceBranchInput').disabled, true, 'sin proyecto no hay ramas que buscar');
  assert.strictEqual(h.el('gitlabTargetBranchInput').disabled, true);

  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);
  assert.strictEqual(h.el('gitlabSourceBranchInput').disabled, false);
  assert.strictEqual(h.el('gitlabTargetBranchInput').disabled, false);
});

check('S6 elegir una sugerencia fija el proyecto y carga sus ramas', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  await type(h, 'gitlabProjectInput', 'chaty');
  await pick(h, 'gitlabProjectInput', 0);

  assert.strictEqual(h.el('gitlabProjectInput').value, 'equipo/chaty');
  assert.strictEqual(h.el('gitlabProjectList').classList.contains('hidden'), true);
  assert.strictEqual(h.el('gitlabProjectInput').getAttribute('aria-expanded'), 'false');
  const branchCalls = callNames(h, 'getGitlabBranches');
  assert.strictEqual(branchCalls.length, 2, 'busqueda predeterminada independiente para origen y destino');
  assert.strictEqual(branchCalls[0].args[1], '42');
  assert.deepStrictEqual(
    branchCalls.slice(0, 2).map((call) => call.args[2]),
    ['AAA-1', 'develop']
  );
  assert.strictEqual(h.el('gitlabSourceBranchInput').disabled, false);
  assert.strictEqual(h.el('gitlabTargetBranchInput').disabled, false);
  assert.strictEqual(h.el('gitlabSourceBranchInput').value, 'AAA-1');
  assert.strictEqual(h.el('gitlabTargetBranchInput').value, 'develop');
  assert.deepStrictEqual(h.el('gitlabSourceBranchList').optionTexts(), ['feature/AAA-1-fix']);
  assert.strictEqual(h.el('gitlabTargetBranchList').classList.contains('hidden'), true);

  const src = await type(h, 'gitlabSourceBranchInput', 'feature');
  assert.deepStrictEqual(src.labels, [
    'feature/AAA-1-fix',
    'feature/mr-copy',
    'Feature/GITLAB-DIFF',
  ]);
  const dst = await type(h, 'gitlabTargetBranchInput', 'release');
  assert.deepStrictEqual(dst.labels, ['release/1.1.1']);
});

check('S8 al elegir proyecto busca por defecto la clave Jira y target develop', async () => {
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

  const branchCalls = callNames(h, 'getGitlabBranches');
  assert.deepStrictEqual(
    branchCalls.map((call) => call.args[2]),
    ['AAA-1', 'develop'],
    'origen busca la clave Jira y destino busca develop'
  );
  assert.strictEqual(h.el('gitlabSourceBranchInput').value, 'AAA-1');
  assert.deepStrictEqual(h.el('gitlabSourceBranchList').optionTexts(), ['feature/AAA-1-fix']);
  assert.strictEqual(h.el('gitlabTargetBranchInput').value, 'develop');

  await pick(h, 'gitlabSourceBranchInput', 0);
  assert.strictEqual(h.el('gitlabTargetBranchList').classList.contains('hidden'), true);
  h.el('copyDoBtn').dispatch('click');
  await settle(h);

  const payload = lastCall(h, 'copyIssue').args[1];
  assert.strictEqual(payload.gitlab.sourceBranch, 'feature/AAA-1-fix');
  assert.strictEqual(payload.gitlab.targetBranch, 'develop');
});

check('S8 una busqueda manual durante los defaults no deja el estado cargando', async () => {
  let finishSourceDefault;
  let finishTargetDefault;
  const h = createHarness({
    apiResults: withProjects({
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabBranches: (config, projectId, term) => {
        if (term === 'AAA-1') {
          return new Promise((resolve) => { finishSourceDefault = resolve; });
        }
        if (term === 'develop') {
          return new Promise((resolve) => { finishTargetDefault = resolve; });
        }
        return Promise.resolve({
          ok: true,
          branches: [{ name: 'feature/AAA-1-fix' }],
          truncated: false,
        });
      },
    }),
  });
  await startCopyWithMr(h);
  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);
  assert.strictEqual(
    h.el('gitlabMessage').textContent.includes('Buscando'),
    false,
    'no se muestra un estado compartido que pueda quedarse colgado'
  );

  await type(h, 'gitlabSourceBranchInput', 'feature/');
  finishSourceDefault({
    ok: true,
    branches: [{ name: 'feature/AAA-1-old' }],
    truncated: false,
  });
  finishTargetDefault({ ok: true, branches: [{ name: 'develop' }], truncated: false });
  await settle(h);

  assert.deepStrictEqual(h.el('gitlabSourceBranchList').optionTexts(), ['feature/AAA-1-fix']);
  assert.strictEqual(
    h.el('gitlabMessage').textContent.includes('Buscando'),
    false,
    'una respuesta por defecto reemplazada no debe dejar el estado de carga colgado'
  );
});

check('S8 si la rama de origen coincide exactamente con la clave Jira se selecciona', async () => {
  const h = createHarness({
    apiResults: withProjects({
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabBranches: (config, projectId, term) =>
        Promise.resolve({
          ok: true,
          branches: term === 'AAA-1' ? [{ name: 'AAA-1' }] : [{ name: 'develop' }],
          truncated: false,
        }),
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
  assert.strictEqual(h.el('gitlabSourceBranchInput').value, 'AAA-1');
  assert.strictEqual(h.el('gitlabTargetBranchInput').value, 'develop');
  assert.strictEqual(h.el('gitlabSourceBranchList').classList.contains('hidden'), true);
  assert.strictEqual(h.el('gitlabTargetBranchList').classList.contains('hidden'), true);

  h.el('copyDoBtn').dispatch('click');
  await settle(h);
  const payload = lastCall(h, 'copyIssue').args[1];
  assert.strictEqual(payload.gitlab.sourceBranch, 'AAA-1');
  assert.strictEqual(payload.gitlab.targetBranch, 'develop');
});

check('S6 sin proyecto elegido no se consultan las ramas', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  await type(h, 'gitlabSourceBranchInput', 'main');
  assert.strictEqual(callNames(h, 'getGitlabBranches').length, 0);
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
  const branchCalls = callNames(h, 'getGitlabBranches');
  assert.strictEqual(branchCalls.length, 2, 'y busca origen y destino por defecto');
  assert.deepStrictEqual(branchCalls.map((call) => call.args[2]), ['AAA-1', 'develop']);

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
  await settle(h);

  assert.strictEqual(callNames(h, 'copyIssue').length, 0, 'no se copia sin proyecto valido');
  const message = h.el('gitlabMessage').textContent + ' ' + h.el('copyMessage').textContent;
  assert.match(message, /proyecto/, `debe avisar del proyecto: ${message}`);
});

check('S6 copiar envia el proyecto elegido y las ramas sugeridas confirmadas', async () => {
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
  await type(h, 'gitlabTargetBranchInput', 'release');
  await pick(h, 'gitlabTargetBranchInput', 0);

  h.el('copyDoBtn').dispatch('click');
  await settle(h);

  const payload = lastCall(h, 'copyIssue').args[1];
  assert.strictEqual(payload.includeMr, true);
  assert.strictEqual(payload.gitlab.projectId, '41');
  assert.strictEqual(payload.gitlab.projectName, 'equipo/notijira');
  assert.strictEqual(payload.gitlab.sourceBranch, 'feature/mr-copy');
  assert.strictEqual(payload.gitlab.targetBranch, 'release/1.1.1');
  assert.match(h.el('statusBar').textContent, /diff de MR/);
});

check('S6 escribir una rama que GitLab no devuelve no vale como seleccion', async () => {
  const h = createHarness({ apiResults: withProjects({ getConfig: CONFIG_WITH_GITLAB }) });
  await startCopyWithMr(h);

  await type(h, 'gitlabProjectInput', 'notijira');
  await pick(h, 'gitlabProjectInput', 0);
  await type(h, 'gitlabSourceBranchInput', 'inexistente');
  h.el('gitlabSourceBranchInput').dispatch('blur');
  await type(h, 'gitlabTargetBranchInput', 'main');
  await pick(h, 'gitlabTargetBranchInput', 0);

  h.el('copyDoBtn').dispatch('click');
  await settle(h);

  assert.strictEqual(callNames(h, 'copyIssue').length, 0, 'no se copia con una rama inexistente');
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
    assert.strictEqual(h.el(listFor(id)).optionTexts().length, 0, `${listFor(id)} queda vacio`);
  }
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

  const branchCalls = callNames(h, 'getGitlabBranches');
  const lastTwo = branchCalls.slice(-2);
  assert.strictEqual(lastTwo[0].args[1], '42', 'las ramas son del proyecto nuevo');
  assert.deepStrictEqual(lastTwo.map((call) => call.args[2]), ['AAA-1', 'develop']);
  assert.strictEqual(h.el('gitlabSourceBranchInput').value, 'AAA-1', 'se reinicia con la clave de la tarea');
  assert.strictEqual(h.el('gitlabTargetBranchInput').value, 'develop', 'se reinicia con el destino por defecto');
  assert.ok(!h.el('gitlabSourceBranchInput').value.includes('main'));
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
