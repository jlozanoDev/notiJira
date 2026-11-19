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
  for (let i = 0; i < 4; i++) await tick();
};

const CONFIG_WITHOUT_GITLAB = { baseUrl: 'https://jira.example', apiToken: 'jira-token' };
const CONFIG_WITH_GITLAB = {
  baseUrl: 'https://jira.example',
  apiToken: 'jira-token',
  gitlabUrl: 'https://gitlab.example',
  gitlabToken: 'gitlab-token',
};

const callNames = (harness, name) => harness.calls.filter((call) => call.name === name);
const lastCall = (harness, name) => callNames(harness, name).slice(-1)[0];

// Marks the MR checkbox exactly like a user clicking it in the copy modal.
async function toggleMr(harness, checked) {
  harness.el('includeMrCheckbox').checked = checked;
  harness.el('includeMrCheckbox').dispatch('change');
  await settle();
}

async function startCopyWithMr(harness) {
  await settle();
  await toggleMr(harness, true);
}

function fillJiraFields(harness) {
  harness.el('baseUrl').value = CONFIG_WITHOUT_GITLAB.baseUrl;
  harness.el('email').value = '';
  harness.el('apiToken').value = CONFIG_WITHOUT_GITLAB.apiToken;
  harness.el('updateUrl').value = '';
}

function fillGitLabFields(harness, url, token) {
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
  const h = createHarness({ apiResults: { getConfig: CONFIG_WITHOUT_GITLAB } });
  await startCopyWithMr(h);

  h.el('cancelBtn').dispatch('click');
  await settle();

  assert.strictEqual(h.isHidden('copyModal'), false, 'la copia debe volver a estar visible');
  assert.strictEqual(h.el('includeMrCheckbox').checked, false);
  assert.strictEqual(h.isHidden('gitlabSelection'), true);
  assert.strictEqual(callNames(h, 'saveConfig').length, 0, 'cancelar no guarda credenciales');
});

check('S2 guardar credenciales desde la copia deja el selector de proyecto visible', async () => {
  const h = createHarness({ apiResults: { getConfig: CONFIG_WITHOUT_GITLAB } });
  await startCopyWithMr(h);
  fillJiraFields(h);
  fillGitLabFields(h, 'gitlab.example', 'gitlab-token');

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
  assert.deepStrictEqual(h.el('gitlabProjectSelect').optionTexts(), [
    'Selecciona un proyecto',
    'equipo/notijira',
  ]);
  assert.strictEqual(h.el('gitlabProjectSelect').disabled, false);
});

check('S2 guardar la configuracion completa restablece el selector de GitLab', async () => {
  const h = createHarness({ apiResults: { getConfig: CONFIG_WITHOUT_GITLAB } });
  await startCopyWithMr(h);
  fillJiraFields(h);
  fillGitLabFields(h, 'https://gitlab.example', 'gitlab-token');

  h.el('configForm').dispatch('submit');
  await settle();

  assert.strictEqual(h.isHidden('gitlabSelection'), false, 'el panel debe verse tras guardar');
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 1);
  assert.strictEqual(lastCall(h, 'saveConfig').args[0].gitlabUrl, 'https://gitlab.example');
});

check('S2 un rechazo al guardar deja la configuracion abierta y no consulta GitLab', async () => {
  const h = createHarness({
    apiResults: {
      getConfig: CONFIG_WITHOUT_GITLAB,
      saveConfig: { ok: false, error: 'La URL de GitLab debe usar HTTPS y no incluir credenciales' },
    },
  });
  await startCopyWithMr(h);
  fillGitLabFields(h, 'http://gitlab.example', 'gitlab-token');

  h.el('saveGitlabCredentialsBtn').dispatch('click');
  await settle();

  assert.match(h.el('formMessage').textContent, /HTTPS/);
  assert.strictEqual(h.isHidden('modal'), false, 'la configuracion sigue abierta para corregirla');
  assert.strictEqual(h.isHidden('gitlabSelection'), true);
  assert.strictEqual(callNames(h, 'getGitlabProjects').length, 0);
});

check('S2 el selector usa la configuracion devuelta por el proceso principal', async () => {
  let stored = { ...CONFIG_WITHOUT_GITLAB };
  const h = createHarness({
    apiResults: {
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
    },
  });
  await startCopyWithMr(h);
  fillGitLabFields(h, 'gitlab.example', 'gitlab-token');

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
  const h = createHarness({ apiResults: { getConfig: CONFIG_WITH_GITLAB } });
  await startCopyWithMr(h);
  fillJiraFields(h);
  fillGitLabFields(h, 'https://gitlab.example', 'otro-token');
  assert.strictEqual(h.isHidden('gitlabSelection'), false, 'con credenciales el panel se abre');

  h.el('removeGitlabCredentialsBtn').dispatch('click');
  await settle();

  const saved = lastCall(h, 'saveConfig').args[0];
  assert.strictEqual(saved.gitlabUrl, '');
  assert.strictEqual(saved.gitlabToken, '');
  assert.strictEqual(h.el('gitlabUrl').value, '');
  assert.strictEqual(h.el('gitlabToken').value, '');
  assert.match(h.el('formMessage').textContent, /eliminadas/);
});

check('S2 una respuesta atrasada no sustituye una seleccion de proyecto mas reciente', async () => {
  let releaseStale;
  let calls = 0;
  const h = createHarness({
    apiResults: {
      getConfig: CONFIG_WITH_GITLAB,
      getGitlabProjects: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise((resolve) => {
            releaseStale = () =>
              resolve({ ok: true, projects: [{ id: 1, pathWithNamespace: 'viejo/proyecto' }] });
          });
        }
        return Promise.resolve({
          ok: true,
          projects: [{ id: 2, pathWithNamespace: 'nuevo/proyecto' }],
        });
      },
    },
  });
  await startCopyWithMr(h);

  await toggleMr(h, false);
  await toggleMr(h, true);
  assert.deepStrictEqual(h.el('gitlabProjectSelect').optionTexts(), [
    'Selecciona un proyecto',
    'nuevo/proyecto',
  ]);

  releaseStale();
  await settle();
  assert.deepStrictEqual(
    h.el('gitlabProjectSelect').optionTexts(),
    ['Selecciona un proyecto', 'nuevo/proyecto'],
    'la respuesta atrasada no debe reemplazar la seleccion actual'
  );
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
