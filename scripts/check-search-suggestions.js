'use strict';
// Headless regression checks for the live suggestions of the Jira search modal.
// Runs the real renderer/renderer.js against the DOM harness with a fake clock,
// so the debounce and the stale-response guard are asserted deterministically.
// Run with: npm run check:search   (node + assert, no test framework).
const assert = require('assert');
const { createHarness } = require('./test-support/renderer-stub');

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// The renderer debounces the suggestions at 250 ms; checks advance a fake clock.
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
const resultRows = (harness) => harness.el('searchResults').children;
const resultsHidden = (harness) => harness.isHidden('searchResults');
const firstKey = (harness) => resultRows(harness)[0].children[0].textContent;

async function openSearch(harness) {
  await settle(harness);
  harness.el('searchBtn').dispatch('click');
  await settle(harness);
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

check('una sola letra no consulta a Jira', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'A');

  assert.strictEqual(callNames(h, 'searchIssues').length, 0, 'no debe pedir sugerencias con 1 caracter');
  assert.ok(resultsHidden(h), 'la lista de resultados sigue oculta');
});

check('escribir sugiere tareas sin pulsar Buscar', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'CLIN');

  const calls = callNames(h, 'searchIssues');
  assert.strictEqual(calls.length, 1, 'una sola consulta tras el debounce');
  assert.strictEqual(calls[0].args[1], 'CLIN', 'consulta el texto escrito');
  assert.ok(!resultsHidden(h), 'la lista de opciones se muestra');
  assert.strictEqual(resultRows(h).length, 1, 'muestra una opción');
});

check('el debounce agrupa las pulsaciones seguidas', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await typeFast(h, ['cl', 'cli', 'clin', 'clini']);

  const calls = callNames(h, 'searchIssues');
  assert.strictEqual(calls.length, 1, 'solo la última pulsación consulta');
  assert.strictEqual(calls[0].args[1], 'clini');
});

check('vaciar el campo limpiar la lista de opciones', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  await type(h, 'CLIN');
  await type(h, '');

  assert.ok(resultsHidden(h), 'la lista se oculta');
  assert.strictEqual(resultRows(h).length, 0, 'no quedan opciones');
});

check('una respuesta lenta no pisa a la mas reciente', async () => {
  const pending = [];
  const h = createHarness({
    apiResults: {
      searchIssues: (config, query) =>
        new Promise((resolve) => pending.push({ query, resolve })),
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

  assert.strictEqual(resultRows(h).length, 1, 'queda una sola lista');
  assert.strictEqual(firstKey(h), 'BBB-2', 'se conserva la respuesta mas reciente');
});

check('el boton Buscar consulta de inmediato y abre la copia', async () => {
  const h = createHarness({ apiResults: { searchIssues: SEARCH_OK } });
  await openSearch(h);
  h.el('searchInput').value = 'AAA-1';
  h.el('searchForm').dispatch('submit');
  await settle(h, 0);

  assert.strictEqual(callNames(h, 'searchIssues').length, 1, 'consulta sin esperar el debounce');
  assert.strictEqual(resultRows(h).length, 1);

  resultRows(h)[0].dispatch('click');
  await settle(h);

  assert.ok(!h.isHidden('copyModal'), 'el clic abre el modal de copia');
  const copyCalls = callNames(h, 'getIssueCopyData');
  assert.strictEqual(copyCalls[copyCalls.length - 1].args[1], 'AAA-1', 'copia la tarea elegida');
});

check('un error de Jira se muestra sin romper la lista', async () => {
  const h = createHarness({ apiResults: { searchIssues: { ok: false, error: 'Jira respondio 401' } } });
  await openSearch(h);
  await type(h, 'CLIN');

  assert.ok(resultsHidden(h), 'no muestra opciones');
  assert.ok(
    h.el('searchMessage').textContent.includes('401'),
    'el mensaje explica el fallo de Jira'
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
  console.log(`SEARCH SUGGESTIONS CHECKS: ${checks.length - failed}/${checks.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error('CHECK FALLA:', err && err.stack);
  process.exitCode = 1;
});
