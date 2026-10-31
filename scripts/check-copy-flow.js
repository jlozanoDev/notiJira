'use strict';
// Headless regression checks for the "copiar tarea para OpenCode" flow.
// Run with: npm run check:copy   (node + assert, no test framework).
const Module = require('module');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const stubPath = path.join(__dirname, 'test-support', 'electron-stub.js');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return stubPath;
  return orig.call(this, request, parent, ...rest);
};
const stub = require(stubPath);

const PNG = Buffer.from('fake-png-bytes');
const PDF = Buffer.from('%PDF-1.4 fake');
const doc = (inner) => ({ type: 'doc', version: 1, content: inner });
const media = (id, alt) => ({ type: 'media', attrs: { id, alt, type: 'file' } });

let requests = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url;
    requests.push({ method: req.method, url, body: body || null });
    const send = (code, b, t) => { res.writeHead(code, { 'Content-Type': t || 'application/json' }); res.end(b); };
    const json = (o) => send(200, JSON.stringify(o));
    if (url.startsWith('/rest/api/3/notifications')) return json({ values: [] });
    if (url.startsWith('/rest/api/3/myself')) return json({ displayName: 'Yo', accountId: 'acc:1' });
    if (url.startsWith('/rest/api/3/search/jql')) {
      const parsed = JSON.parse(body || '{}');
      return json({ issues: [
        { key: 'AAA-1', id: '1', fields: { summary: 'Primera', status: { name: 'Abierta' }, issuetype: { name: 'Tarea' }, updated: '2026-10-30T10:00:00.000Z' } },
      ], _jql: parsed.jql, _max: parsed.maxResults });
    }
    if (url.startsWith('/rest/api/2/issue/AAA-1/comment')) return json({ comments: [], total: 0 });
    if (url.startsWith('/rest/api/3/issue/AAA-1/comment')) return json({
      comments: [{ id: 'c1', author: { displayName: 'Ana' }, created: '2026-10-20T10:00:00.000Z', body: doc([{ type: 'paragraph', content: [{ type: 'text', text: 'ver ' }, media('9002', 'pdf')] }]) }],
      total: 1,
    });
    if (url.startsWith('/rest/api/3/issue/AAA-1')) return json({ key: 'AAA-1', id: '1', fields: {
      summary: 'Tarea con adjuntos', status: { name: 'Abierta' }, issuetype: { name: 'Tarea' },
      attachment: [
        { id: '9001', filename: 'roto.png', size: 9, content: 'http://jira.example/secure/attachment/9001/roto.png' },
        { id: '9002', filename: 'informe.pdf', size: 9, content: 'http://jira.example/secure/attachment/9002/informe.pdf' },
      ],
      customfield_10090: '2026-10-19T13:25:39.283Z',
      updated: '2026-10-30T10:00:00.000Z',
      customfield_10218: doc([{ type: 'paragraph', content: [{ type: 'text', text: 'con imagen ' }, media('9001', 'rota')] }]),
      customfield_10253: null, customfield_10250: null, customfield_10450: null,
      customfield_10448: null, customfield_10251: null, customfield_10481: null,
    } });
    if (url.startsWith('/rest/api/3/issue/ZZZ-1')) return send(404, JSON.stringify({ errorMessages: ['Issue does not exist'] }));
    if (url.startsWith('/rest/api/3/issue/FOR-403')) return send(403, JSON.stringify({ errorMessages: ['no permission'] }));
    if (url.startsWith('/rest/api/3/attachment/content/9001')) return send(500, JSON.stringify({ errorMessages: ['boom'] }));
    if (url.startsWith('/rest/api/3/attachment/content/9002')) return send(200, PDF, 'application/pdf');
    if (url.startsWith('/secure/attachment/9002')) return send(200, PDF, 'application/pdf');
    return send(404, JSON.stringify({ errorMessages: ['ruta desconocida ' + url] }));
  });
});

const checks = [];
const check = (name, fn) => { checks.push({ name, fn }); };

// --- S1 ------------------------------------------------------------------
check('S1 clave directa: GET de la tarea y 1 resultado', async (h, config) => {
  requests = [];
  const r = await h['jira:searchIssues']({}, { config, query: 'AAA-1' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.results.length, 1);
  assert.strictEqual(r.results[0].key, 'AAA-1');
  assert.ok(r.results[0].summary && r.results[0].status && r.results[0].updated, 'clave, resumen, estado y fecha');
  assert.ok(requests.some((x) => x.url.startsWith('/rest/api/3/issue/AAA-1')), 'debe hacer GET directo de la clave');
});

check('S1 busqueda por texto: JQL exacto y maxResults 20', async (h, config) => {
  requests = [];
  const r = await h['jira:searchIssues']({}, { config, query: 'whatsapp' });
  assert.strictEqual(r.ok, true);
  const search = requests.find((x) => x.url.includes('/search/jql'));
  const body = JSON.parse(search.body);
  assert.strictEqual(body.jql, 'text ~ "whatsapp" ORDER BY updated DESC');
  assert.strictEqual(body.maxResults, 20);
});

check('S1 comillas y barras del texto se escapan en el JQL', async (h, config) => {
  requests = [];
  await h['jira:searchIssues']({}, { config, query: 'foo"bar\\baz' });
  const body = JSON.parse(requests.find((x) => x.url.includes('/search/jql')).body);
  assert.ok(!/text ~ "foo"bar/.test(body.jql), 'la comilla debe ir escapada: ' + body.jql);
  assert.strictEqual(body.jql, 'text ~ "foo\\"bar\\\\baz" ORDER BY updated DESC');
});

check('S1 clave inexistente: se avisa del error y se permite buscar', async (h, config) => {
  const r = await h['jira:searchIssues']({}, { config, query: 'ZZZ-1' });
  assert.ok(r.ok === false || r.error, 'debe mostrarse el error de la clave inexistente');
});

check('S1 clave sin permiso: el error se propaga a la UI', async (h, config) => {
  const r = await h['jira:searchIssues']({}, { config, query: 'FOR-403' });
  assert.strictEqual(r.ok, false);
  assert.ok(/403/.test(r.error), r.error);
});

check('S1 texto vacio: error explicito', async (h, config) => {
  const r = await h['jira:searchIssues']({}, { config, query: '   ' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'Escribe una clave de tarea o una descripcion');
});

// --- S2 ------------------------------------------------------------------
check('S2 ocho secciones en el orden de la spec, con vacias marcadas', async (h, config) => {
  const r = await h['jira:issueCopyData']({}, { config, issueKey: 'AAA-1' });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.sections.map((s) => s.label), [
    'Entrada', 'PreAnálisis', 'Contexto', 'Análisis Funcional',
    'Casos de Prueba', 'Desglose Funcional', 'Análisis Técnico', 'QA',
  ]);
  assert.strictEqual(r.sections.filter((s) => !s.empty).length, 2);
  assert.strictEqual(r.sections.find((s) => s.label === 'Contexto').empty, true);
});

check('S2 comentarios con autor, fecha y vista previa', async (h, config) => {
  const r = await h['jira:issueCopyData']({}, { config, issueKey: 'AAA-1' });
  assert.strictEqual(r.comments.length, 1);
  assert.strictEqual(r.comments[0].author, 'Ana');
  assert.ok(r.comments[0].created);
  assert.ok(r.comments[0].preview.length > 0);
});

// --- S3 / S4 -------------------------------------------------------------
check('S3/S4 descarga a userData/copied/<CLAVE> y enlaza rutas locales', async (h, config) => {
  const r = await h['copy:issue']({}, {
    config, issueKey: 'AAA-1',
    sections: ['customfield_10090', 'customfield_10218'], comments: ['c1'],
  });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.sections, 2);
  assert.strictEqual(r.comments, 1);
  assert.strictEqual(r.attachments, 2);
  assert.strictEqual(r.failed, 1, 'la descarga fallida debe avisarse en el resultado');
  const dir = path.join(stub.__userData, 'copied', 'AAA-1');
  assert.deepStrictEqual(fs.readdirSync(dir), ['informe.pdf']);
  const md = stub.__getClipboard();
  assert.ok(md.includes(path.join('copied', 'AAA-1', 'informe.pdf').replace(/\\/g, '/')), md);
  assert.ok(md.includes('http://jira.example/secure/attachment/9001/roto.png'), 'URL de Jira como mejor esfuerzo');
});

check('S4 markdown en el orden de la spec y escrito en el portapapeles', async (h, config) => {
  await h['copy:issue']({}, {
    config, issueKey: 'AAA-1',
    sections: ['customfield_10090', 'customfield_10218'], comments: ['c1'],
  });
  const md = stub.__getClipboard();
  assert.ok(md.startsWith('# AAA-1 — Tarea con adjuntos'), md);
  assert.ok(md.includes('/browse/AAA-1'), 'enlace a la tarea');
  const iEntrada = md.indexOf('## Entrada');
  const iPre = md.indexOf('## PreAnálisis');
  const iCom = md.indexOf('## Comentarios');
  const iAdj = md.indexOf('## Adjuntos');
  assert.ok(iEntrada > 0 && iPre > iEntrada && iCom > iPre && iAdj > iCom, 'orden de bloques');
  assert.ok(md.includes('### Ana · '), 'autor y fecha del comentario');
  assert.ok(stub.__getClipboard() === md, 'el portapapeles contiene el markdown');
});

check('S4 la respuesta indica la carpeta usada', async (h, config) => {
  const r = await h['copy:issue']({}, {
    config, issueKey: 'AAA-1', sections: ['customfield_10090'], comments: [],
  });
  const folder = r.folder || r.dir || r.outputDir;
  assert.ok(typeof folder === 'string' && folder.includes('AAA-1'), 'la respuesta debe incluir la carpeta: ' + JSON.stringify(r));
});

check('S4 sin seleccion: error explicito', async (h, config) => {
  const r = await h['copy:issue']({}, { config, issueKey: 'AAA-1', sections: [], comments: [] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'No has seleccionado nada para copiar');
});

// --- regresion item 6 (ruta de notificaciones) ---------------------------
check('REGRESION la ruta de notificaciones sigue usando maxResults 100', async (h, config) => {
  requests = [];
  const r = await h['jira:notifications']({}, config);
  assert.strictEqual(r.ok, true, r.error);
  const search = requests.find((x) => x.url.includes('/search/jql'));
  const body = JSON.parse(search.body);
  assert.strictEqual(body.maxResults, 100, 'la ruta de menciones debe seguir pidiendo 100');
  assert.ok(body.jql.includes('comment ~ currentUser()'), body.jql);
  assert.ok(requests.some((x) => x.url.includes('/rest/api/2/issue/')), 'comentarios en api/2');
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  require(path.join(REPO, 'main.js'));
  const h = stub.__handlers;
  const config = { baseUrl: 'http://127.0.0.1:' + port, apiToken: 'tok', email: '' };
  let failed = 0;
  for (const c of checks) {
    stub.__reset();
    try {
      await c.fn(h, config);
      console.log('  ok  - ' + c.name);
    } catch (err) {
      failed += 1;
      console.log('  FAIL- ' + c.name + ' :: ' + (err && err.message));
    }
  }
  stub.__reset();
  server.close();
  console.log(`COPY CHECKS: ${checks.length - failed}/${checks.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error('CHECK FALLA:', err && err.stack); process.exitCode = 1; });
