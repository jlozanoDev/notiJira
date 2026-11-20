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
    requests.push({
      method: req.method,
      url,
      body: body || null,
      privateToken: req.headers['private-token'] || '',
    });
    const send = (code, b, t) => { res.writeHead(code, { 'Content-Type': t || 'application/json' }); res.end(b); };
    const json = (o) => send(200, JSON.stringify(o));
    if (url.startsWith('/api/v4/projects?')) {
      if (req.headers['private-token'] === 'redirect-test-token') {
        res.writeHead(302, { Location: '/redirect-target' });
        res.end();
        return;
      }
      const params = new URL(url, 'http://localhost').searchParams;
      const term = (params.get('search') || '').toLowerCase();
      if (term === 'muchos') {
        const many = [];
        for (let i = 0; i < 100; i++) {
          many.push({ id: 900 + i, name: `proyecto-${i}`, path_with_namespace: `grupo/proyecto-${i}` });
        }
        return json(many);
      }
      const pool = [
        { id: 41, name: 'NotiJira', path_with_namespace: 'equipo/notijira' },
        { id: 42, name: 'Chaty', path_with_namespace: 'equipo/chaty' },
      ];
      return json(pool.filter((p) => !term || p.path_with_namespace.toLowerCase().includes(term)));
    }
    if (url === '/redirect-target') return json([{ id: 99, name: 'Unexpected' }]);
    if (url.startsWith('/api/v4/projects/41/repository/branches?')) {
      const params = new URL(url, 'http://localhost').searchParams;
      const term = (params.get('search') || '').toLowerCase();
      if (term === 'muchas') {
        const many = [];
        for (let i = 0; i < 100; i++) many.push({ name: `rama-${i}` });
        return json(many);
      }
      const pool = [{ name: 'main' }, { name: 'feature/gitlab-diff' }];
      return json(pool.filter((b) => !term || b.name.toLowerCase().includes(term)));
    }
    if (url.startsWith('/api/v4/projects/41/repository/compare?')) {
      const refs = new URL(url, 'http://localhost').searchParams;
      if (refs.get('to') === 'feature/empty') return json({ diffs: [], compare_timeout: false });
      if (refs.get('to') === 'feature/timeout') return json({ diffs: [], compare_timeout: true });
      if (refs.get('to') === 'feature/overflow') {
        return json({ diffs: [], overflow: true, compare_timeout: false });
      }
      return json({
        diffs: [{
          old_path: 'src/app.js',
          new_path: 'src/app.js',
          diff: '@@ -1 +1 @@\n-old\n+new',
          too_large: refs.get('to') === 'feature/large',
        }],
        compare_timeout: false,
      });
    }
    if (url.startsWith('/api/v4/projects/404/')) {
      return send(404, JSON.stringify({ message: 'Project not found' }));
    }
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
  assert.ok(!Object.prototype.hasOwnProperty.call(r, 'includeMr'), 'legacy copy response shape stays unchanged');
});

check('S4 sin seleccion: error explicito', async (h, config) => {
  const r = await h['copy:issue']({}, { config, issueKey: 'AAA-1', sections: [], comments: [] });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'No has seleccionado nada para copiar');
});

// --- GitLab integration ---------------------------------------------------
check('GitLab credentials are saved, returned, and removable without losing Jira config', async (h, config) => {
  const savedConfig = {
    ...config,
    email: 'jira@example.com',
    gitlabUrl: config.baseUrl,
    gitlabToken: 'gitlab-test-token',
  };
  assert.deepStrictEqual(await h['config:save']({}, savedConfig), { ok: true });
  const persisted = JSON.parse(fs.readFileSync(path.join(stub.__userData, 'config.json'), 'utf8'));
  assert.strictEqual(persisted.gitlabUrl, config.baseUrl);
  assert.strictEqual(persisted.gitlabToken, 'gitlab-test-token');
  assert.strictEqual((await h['config:get']()).gitlabToken, 'gitlab-test-token');

  assert.deepStrictEqual(await h['config:save']({}, {
    ...savedConfig,
    gitlabUrl: '',
    gitlabToken: '',
  }), { ok: true });
  const removed = await h['config:get']();
  assert.strictEqual(removed.gitlabUrl, '');
  assert.strictEqual(removed.gitlabToken, '');
  assert.strictEqual(removed.apiToken, config.apiToken, 'Jira token must remain intact');
});

check('config:save rejects a bad GitLab URL without throwing or discarding Jira config', async (h, config) => {
  assert.deepStrictEqual(await h['config:save']({}, {
    ...config,
    gitlabUrl: 'https://gitlab.example.com',
    gitlabToken: 'gitlab-test-token',
  }), { ok: true });
  const before = fs.readFileSync(path.join(stub.__userData, 'config.json'), 'utf8');

  const result = await h['config:save']({}, {
    baseUrl: 'https://nuevo-jira.example.com',
    email: '',
    apiToken: 'otro-token',
    updateUrl: '',
    gitlabUrl: 'http://no-local.example.com',
    gitlabToken: 'gitlab-test-token',
  });
  assert.strictEqual(result.ok, false, 'invalid GitLab URL must be reported, not thrown');
  assert.match(result.error, /HTTPS/);
  assert.strictEqual(
    fs.readFileSync(path.join(stub.__userData, 'config.json'), 'utf8'),
    before,
    'a rejected save must leave config.json byte-identical'
  );
});

check('config:save rejects a malformed GitLab URL', async (h, config) => {
  const result = await h['config:save']({}, { ...config, gitlabUrl: 'ht!tp://%%%', gitlabToken: 't' });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no es valida/);
});

check('GitLab projects and branches are fetched with the configured token', async (h, config) => {
  requests = [];
  const gitlabConfig = { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' };
  const projects = await h['gitlab:projects']({}, { config: gitlabConfig });
  assert.strictEqual(projects.ok, true, projects.error);
  assert.deepStrictEqual(projects.projects.map((project) => project.pathWithNamespace), [
    'equipo/notijira',
    'equipo/chaty',
  ]);

  const branches = await h['gitlab:branches']({}, { config: gitlabConfig, projectId: 41 });
  assert.strictEqual(branches.ok, true, branches.error);
  assert.deepStrictEqual(branches.branches.map((branch) => branch.name), [
    'main',
    'feature/gitlab-diff',
  ]);
  const gitlabRequests = requests.filter((request) => request.url.startsWith('/api/v4/'));
  assert.strictEqual(gitlabRequests.length, 2);
  assert.ok(gitlabRequests.every((request) => request.privateToken === 'gitlab-test-token'));
  assert.ok(gitlabRequests.every((request) => request.url.includes('per_page=100')));
  assert.ok(gitlabRequests.every((request) => request.url.includes('page=1')));
  assert.ok(
    gitlabRequests.every((request) => !/[?&]search=/.test(request.url)),
    'sin texto no se envia el parametro search'
  );
});

check('copy:issue appends the selected GitLab source-to-target diff after Jira Markdown', async (h, config) => {
  requests = [];
  const gitlabConfig = { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' };
  const result = await h['copy:issue']({}, {
    config: gitlabConfig,
    issueKey: 'AAA-1',
    sections: ['customfield_10090'],
    comments: [],
    includeMr: true,
    gitlab: {
      projectId: 41,
      projectName: 'equipo/notijira',
      sourceBranch: 'feature/gitlab-diff',
      targetBranch: 'main',
    },
  });
  assert.strictEqual(result.ok, true, result.error);
  const markdown = stub.__getClipboard();
  const attachmentIndex = markdown.indexOf('## Adjuntos');
  const diffIndex = markdown.indexOf('## Diff');
  assert.ok(attachmentIndex > 0 && diffIndex > attachmentIndex, 'diff must follow the prior Jira copy');
  assert.ok(markdown.includes('feature/gitlab-diff → main'), markdown);
  assert.ok(markdown.includes('diff --git a/src/app.js b/src/app.js'), markdown);
  assert.ok(markdown.includes('@@ -1 +1 @@\n-old\n+new'), markdown);
  assert.ok(!markdown.includes('gitlab-test-token'), 'GitLab token must never enter copied Markdown');
  const comparison = requests.find((request) =>
    request.url.startsWith('/api/v4/projects/41/repository/compare?')
  );
  assert.ok(comparison, 'GitLab comparison endpoint must be called');
  const refs = new URL(comparison.url, 'http://localhost').searchParams;
  assert.strictEqual(refs.get('from'), 'main', 'target is the comparison base');
  assert.strictEqual(refs.get('to'), 'feature/gitlab-diff', 'source is the comparison head');
  assert.strictEqual(comparison.privateToken, 'gitlab-test-token');
});

check('copy:issue rechaza un GitLab no local y no copia nada', async (h, config) => {
  stub.__reset();
  const result = await h['copy:issue']({}, {
    config: { ...config, gitlabUrl: 'http://gitlab.example.com', gitlabToken: 'gitlab-test-token' },
    issueKey: 'AAA-1',
    sections: ['customfield_10090'],
    comments: [],
    includeMr: true,
    gitlab: { projectId: 41, sourceBranch: 'feature/gitlab-diff', targetBranch: 'main' },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /HTTPS/);
  assert.strictEqual(stub.__getClipboard(), '', 'un MR rechazado no debe escribir en el portapapeles');
});

check('GitLab no presenta un diff truncado como si no hubiera diferencias', async (h, config) => {
  stub.__reset();
  const result = await h['copy:issue']({}, {
    config: { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' },
    issueKey: 'AAA-1',
    sections: ['customfield_10090'],
    comments: [],
    includeMr: true,
    gitlab: {
      projectId: 41,
      projectName: 'equipo/notijira',
      sourceBranch: 'feature/overflow',
      targetBranch: 'main',
    },
  });
  assert.strictEqual(result.ok, false, 'un diff incompleto debe fallar, no copiarse vacio');
  assert.match(result.error, /demasiado grande/);
  assert.ok(!stub.__getClipboard().includes('No hay diferencias'), 'no debe afirmarse que no hay cambios');
});

check('GitLab API does not follow redirects while sending credentials', async (h, config) => {
  requests = [];
  const result = await h['gitlab:projects']({}, {
    ...config,
    gitlabUrl: config.baseUrl,
    gitlabToken: 'redirect-test-token',
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(requests.filter((request) => request.url.startsWith('/api/v4/')).length, 1);
  assert.ok(!requests.some((request) => request.url === '/redirect-target'));
});

check('copy:issue does not overwrite the clipboard when GitLab credentials are missing', async (h, config) => {
  const result = await h['copy:issue']({}, {
    config,
    issueKey: 'AAA-1',
    sections: ['customfield_10090'],
    comments: [],
    includeMr: true,
    gitlab: { projectId: 41, sourceBranch: 'feature/gitlab-diff', targetBranch: 'main' },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'Falta la URL de GitLab');
  assert.strictEqual(stub.__getClipboard(), '');
});

check('GitLab empty comparison is appended as an explicit no-diff result', async (h, config) => {
  const result = await h['copy:issue']({}, {
    config: { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' },
    issueKey: 'AAA-1',
    sections: ['customfield_10090'],
    comments: [],
    includeMr: true,
    gitlab: {
      projectId: 41,
      projectName: 'equipo/notijira',
      sourceBranch: 'feature/empty',
      targetBranch: 'main',
    },
  });
  assert.strictEqual(result.ok, true, result.error);
  const markdown = stub.__getClipboard();
  assert.ok(markdown.includes('## Diff de MR'), markdown);
  assert.ok(markdown.includes('No hay diferencias entre las ramas seleccionadas.'), markdown);
});

check('GitLab timeout and incomplete diffs fail without copying partial output', async (h, config) => {
  for (const sourceBranch of ['feature/timeout', 'feature/large']) {
    stub.__reset();
    const result = await h['copy:issue']({}, {
      config: { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' },
      issueKey: 'AAA-1',
      sections: ['customfield_10090'],
      comments: [],
      includeMr: true,
      gitlab: {
        projectId: 41,
        projectName: 'equipo/notijira',
        sourceBranch,
        targetBranch: 'main',
      },
    });
    assert.strictEqual(result.ok, false, sourceBranch);
    assert.match(result.error, /GitLab/);
    assert.strictEqual(stub.__getClipboard(), '', sourceBranch);
  }
});

// --- S7: busqueda en el servidor ------------------------------------------
check('S7 gitlab:projects manda search y solo pide la pagina 1', async (h, config) => {
  requests = [];
  const gitlabConfig = { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' };
  const result = await h['gitlab:projects']({}, { config: gitlabConfig, search: 'chaty' });
  assert.strictEqual(result.ok, true, result.error);
  assert.deepStrictEqual(result.projects.map((project) => project.pathWithNamespace), [
    'equipo/chaty',
  ]);
  const calls = requests.filter((request) => request.url.startsWith('/api/v4/projects?'));
  assert.strictEqual(calls.length, 1, 'una sola peticion por busqueda');
  const params = new URL(calls[0].url, 'http://localhost').searchParams;
  assert.strictEqual(params.get('search'), 'chaty');
  assert.strictEqual(params.get('page'), '1');
  assert.strictEqual(params.get('per_page'), '100');
  assert.strictEqual(result.truncated, false);
});

check('S7 gitlab:branches manda search dentro del proyecto elegido', async (h, config) => {
  requests = [];
  const gitlabConfig = { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' };
  const result = await h['gitlab:branches']({}, {
    config: gitlabConfig,
    projectId: 41,
    search: 'feature',
  });
  assert.strictEqual(result.ok, true, result.error);
  assert.deepStrictEqual(result.branches.map((branch) => branch.name), ['feature/gitlab-diff']);
  const calls = requests.filter((request) =>
    request.url.startsWith('/api/v4/projects/41/repository/branches?')
  );
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(new URL(calls[0].url, 'http://localhost').searchParams.get('search'), 'feature');
});

check('S7 una pagina completa se marca como truncada sin pedir la siguiente', async (h, config) => {
  requests = [];
  const gitlabConfig = { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' };
  const projects = await h['gitlab:projects']({}, { config: gitlabConfig, search: 'muchos' });
  assert.strictEqual(projects.ok, true, projects.error);
  assert.strictEqual(projects.projects.length, 100);
  assert.strictEqual(projects.truncated, true, '100 resultados = puede haber mas');
  const branches = await h['gitlab:branches']({}, {
    config: gitlabConfig,
    projectId: 41,
    search: 'muchas',
  });
  assert.strictEqual(branches.truncated, true);
  const pageTwo = requests.filter((request) => /[?&]page=2/.test(request.url));
  assert.deepStrictEqual(pageTwo, [], 'no se recorre la pagina 2');
});

check('S7 la busqueda sigue enviando el token solo a GitLab', async (h, config) => {
  requests = [];
  const gitlabConfig = { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' };
  await h['gitlab:projects']({}, { config: gitlabConfig, search: 'noti' });
  const calls = requests.filter((request) => request.url.startsWith('/api/v4/'));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].privateToken, 'gitlab-test-token');
  assert.ok(!calls[0].url.includes('gitlab-test-token'), 'el token nunca va en la URL');
});

check('S7 no se envian parametros que la spec no pide', async (h, config) => {
  requests = [];
  const gitlabConfig = { ...config, gitlabUrl: config.baseUrl, gitlabToken: 'gitlab-test-token' };
  await h['gitlab:projects']({}, { config: gitlabConfig, search: 'noti' });
  await h['gitlab:branches']({}, { config: gitlabConfig, projectId: 41, search: 'feature' });
  const calls = requests.filter((request) => request.url.startsWith('/api/v4/'));
  assert.strictEqual(calls.length, 2);
  for (const call of calls) {
    const params = new URL(call.url, 'http://localhost').searchParams;
    assert.ok(!params.has('order_by'), 'order_by no pedido: ' + call.url);
    assert.ok(!params.has('sort'), 'sort no pedido: ' + call.url);
    assert.ok(!params.has('regex'), 'regex no pedido: ' + call.url);
  }
});

check('S1/S2 GitLab controls are wired through the preload and prompt for missing credentials', async () => {
  const html = fs.readFileSync(path.join(REPO, 'renderer', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(REPO, 'renderer', 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(REPO, 'preload.js'), 'utf8');
  for (const id of [
    'gitlabUrl',
    'gitlabToken',
    'saveGitlabCredentialsBtn',
    'removeGitlabCredentialsBtn',
    'includeMrCheckbox',
    'gitlabProjectInput',
    'gitlabSourceBranchInput',
    'gitlabTargetBranchInput',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing UI element ${id}`);
  }
  assert.ok(preload.includes('getGitlabProjects'), 'project lookup must use the preload bridge');
  assert.ok(preload.includes('getGitlabBranches'), 'branch lookup must use the preload bridge');
  assert.ok(renderer.includes('openGitlabSettingsForCopy()'), 'missing credentials must open setup');
  assert.ok(renderer.includes('option.textContent = item.label'), 'remote option labels use textContent');
});

check('S1 the Obtener MR checkbox sits in the copy header next to the title', async () => {
  const html = fs.readFileSync(path.join(REPO, 'renderer', 'index.html'), 'utf8');
  const header = html.match(/<div class="copy-header">[\s\S]*?<\/div>/);
  assert.ok(header, 'the copy header must wrap the title and the checkbox');
  assert.ok(header[0].includes('id="copyTitle"'), 'the header must contain the title');
  assert.ok(header[0].includes('id="includeMrCheckbox"'), 'the header must contain the MR checkbox');
  assert.ok(
    header[0].indexOf('id="copyTitle"') < header[0].indexOf('id="includeMrCheckbox"'),
    'the checkbox belongs to the right of the title'
  );
  const styles = fs.readFileSync(path.join(REPO, 'renderer', 'styles.css'), 'utf8');
  assert.ok(/\.copy-header\s*\{[^}]*justify-content:\s*space-between/.test(styles), 'header must right-align the checkbox');
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
  let failed = 0;
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    require(path.join(REPO, 'main.js'));
    const h = stub.__handlers;
    const config = { baseUrl: 'http://127.0.0.1:' + port, apiToken: 'tok', email: '' };
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
  } catch (err) {
    failed = checks.length;
    console.error('CHECK FALLA:', err && err.stack);
  } finally {
    // Sin esto, un fallo al cargar main.js dejaria el servidor abierto y el
    // proceso colgado para siempre.
    server.close();
    stub.__reset();
    console.log(`COPY CHECKS: ${checks.length - failed}/${checks.length} passed`);
    process.exitCode = failed ? 1 : 0;
  }
})();
