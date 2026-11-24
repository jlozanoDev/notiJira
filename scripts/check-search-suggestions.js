'use strict';
// Headless regression checks for the Jira search combobox in the search modal.
// Runs the real renderer/renderer.js against the DOM harness with a fake clock,
// so the debounce, the keyboard navigation and the stale-response guard are
// asserted deterministically.
// Run with: npm run check:search   (node + assert, no test framework).
const assert = require('assert');
const { createHarness } = require('./test-support/renderer-stub');

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// The combobox debounces the queries at 250 ms; checks advance a fake clock.
const DEBOUNCE = 250;
const settle = async (harness, ms = DEBOUNCE + 70) => {
  for (let i = 0; i < 3; i++) await tick();
  if (harness && ms) await harness.advance(ms);
  for (let i = 0; i < 6; i++) await tick();
};

const result = (key) => ({
  key,
  summary: 'Tarea ' + key,
  status: 'Abierta',
  issuetype: 'Tarea',
  updated: '2026-11-01T10:00:00.000Z',
  webUrl: 'https://jira.example/browse/' + key,
});

const SEARCH_OK = { ok: true, results: [result('AAA-1')] };

const callNames = (harness, name) => harness.calls.filter((call) => call.name === name);
const options = (harness) => harness.el('searchList').children;
const listHidden = (harness) => harness.isHidden('searchList');
const message = (harness) => harness.el('searchMessage').textContent;

async function openSearch(harness) {
  await settle(harness);
  harness.el('searchBtn').dispatch('click');
  await settle(harness, 0);
}

async function type(harness, text) {
  const input = harness.el('searchInput');
  input.value = text;
  input.dispatch('input');
  await settle(harness);
}

// Types several times without letting the debounce fire in between.
async function typeFast(harness, texts) {
  const input = harness.el('searchInput');
  for (const text of texts) {
    input.value = text;
    input.dispatch('input');
  }
  await settle(harness);
}

function press(harness, name) {
  harness.el('searchInput').dispatch('keydown', {
    key: name,
    preventDefault: () => {},
  });
}

check('menos de 2 caracteres no consulta a Jira y mantiene la lista cerrada', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'A');

  assert.strictEqual(callNames(h, 'searchIssues').length, 0, 'no consulta con 1 caracter');
  assert.ok(listHidden(h), 'la lista sigue oculta');
  assert.ok(/al menos 2/.test(message(h)), 'explica el minimo de caracteres');
});

check('escribir abre el combo con las coincidencias de Jira', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'CLIN');

  const calls = callNames(h, 'searchIssues');
  assert.strictEqual(calls.length, 1, 'una sola consulta tras el debounce');
  assert.strictEqual(calls[0].args[1], 'CLIN', 'consulta el texto escrito');
  assert.ok(!listHidden(h), 'el combo se despliega');
  assert.strictEqual(options(h).length, 1, 'muestra una opcion');

  const option = options(h)[0];
  assert.strictEqual(option.children[0].textContent, 'AAA-1', 'muestra la clave');
  assert.strictEqual(option.children[1].textContent, 'Tarea AAA-1', 'muestra el resumen');
});

check('el debounce agrupa las pulsaciones seguidas', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await typeFast(h, ['cl', 'cli', 'clin', 'clini']);

  const calls = callNames(h, 'searchIssues');
  assert.strictEqual(calls.length, 1, 'solo la ultima pulsacion consulta');
  assert.strictEqual(calls[0].args[1], 'clini');
});

check('una respuesta lenta no pisa a la mas reciente', async () => {
  const pending = [];
  const h = createHarness({
    apiResults: {
      searchIssues: (config, query) => new Promise((resolve) => pending.push({ query, resolve })),
    },
  });
  await openSearch(h);
  await type(h, 'AAA');
  await type(h, 'AAAB');

  assert.strictEqual(pending.length, 2, 'dos consultas en vuelo');
  pending[1].resolve({ ok: true, results: [result('BBB-2')] });
  await settle(h, 0);
  pending[0].resolve({ ok: true, results: [result('CCC-3')] });
  await settle(h, 0);

  assert.strictEqual(options(h).length, 1, 'queda una sola lista');
  assert.strictEqual(options(h)[0].children[0].textContent, 'BBB-2', 'se conserva la ultima');
});

check('sin coincidencias se ve el aviso del combo', async () => {
  const h = createHarness({ apiResults: { searchIssues: { ok: true, results: [] } } });
  await openSearch(h);
  await type(h, 'zzzz');

  assert.ok(!listHidden(h), 'el combo sigue desplegado');
  assert.strictEqual(options(h).length, 1, 'muestra una fila de aviso');
  assert.strictEqual(options(h)[0].textContent, 'Sin coincidencias');
  assert.ok(/Sin coincidencias/.test(message(h)), 'el mensaje ayuda a reformular');
});

check('flechas y Enter abren la tarea marcada', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'CLIN');

  press(h, 'ArrowDown');
  await settle(h, 0);
  assert.ok(options(h)[0].classList.contains('active'), 'la primera opcion queda activa');

  press(h, 'Enter');
  await settle(h);

  assert.ok(listHidden(h), 'el combo se cierra');
  assert.ok(!h.isHidden('copyModal'), 'se abre la modal de copia');
  const copyCalls = callNames(h, 'getIssueCopyData');
  assert.strictEqual(copyCalls[copyCalls.length - 1].args[1], 'AAA-1', 'copia la tarea elegida');
});

check('clic en una opcion abre la tarea', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'CLIN');
  options(h)[0].dispatch('mousedown', { preventDefault: () => {} });
  await settle(h);

  assert.ok(!h.isHidden('copyModal'), 'el clic abre la modal de copia');
  assert.strictEqual(h.el('searchInput').value, '', 'el campo queda limpio al cerrar');
});

check('Esc cierra la lista y conserva lo escrito', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'CLIN');
  press(h, 'Escape');
  await settle(h, 0);

  assert.ok(listHidden(h), 'la lista se oculta');
  assert.strictEqual(h.el('searchInput').value, 'CLIN', 'no borra el texto');
});

check('un error de Jira se muestra en el mensaje', async () => {
  const h = createHarness({
    apiResults: { searchIssues: { ok: false, error: 'Jira respondio 401' } },
  });
  await openSearch(h);
  await type(h, 'CLIN');

  assert.ok(listHidden(h), 'no muestra opciones');
  assert.ok(/401/.test(message(h)), 'el mensaje explica el fallo de Jira');
});

check('reabrir el buscador parte de cero', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'CLIN');
  h.el('searchCancelBtn').dispatch('click');
  await settle(h, 0);
  assert.ok(h.isHidden('searchModal'), 'la modal se cierra');

  h.el('searchBtn').dispatch('click');
  await settle(h, 0);
  assert.strictEqual(h.el('searchInput').value, '', 'el campo vuelve vacio');
  assert.ok(listHidden(h), 'la lista vuelve cerrada');
  assert.strictEqual(options(h).length, 0, 'sin opciones viejas');
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
  console.log(`SEARCH COMBO CHECKS: ${checks.length - failed}/${checks.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error('CHECK FALLA:', err && err.stack);
  process.exitCode = 1;
});
